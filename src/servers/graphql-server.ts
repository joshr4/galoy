import { createServer } from "http"

import { getApolloConfig, getJwksArgs, isDev } from "@config"
import { baseLogger } from "@services/logger"
import {
  ApolloServerPluginDrainHttpServer,
  ApolloServerPluginLandingPageDisabled,
  ApolloServerPluginLandingPageGraphQLPlayground,
} from "apollo-server-core"
import { ApolloError, ApolloServer } from "apollo-server-express"
import express from "express"
import { execute, GraphQLError, GraphQLSchema, subscribe } from "graphql"
import helmet from "helmet"
import jsonwebtoken from "jsonwebtoken"
import PinoHttp from "pino-http"
import {
  ExecuteFunction,
  SubscribeFunction,
  SubscriptionServer,
} from "subscriptions-transport-ws"

import { mapError } from "@graphql/error-map"

import { parseIps } from "@domain/users-ips"

import { fieldExtensionsEstimator, simpleEstimator } from "graphql-query-complexity"

import { createComplexityPlugin } from "graphql-query-complexity-apollo-plugin"

import jwksRsa from "jwks-rsa"

import { sendOathkeeperRequest } from "@services/oathkeeper"

import { expressjwt, GetVerificationKey } from "express-jwt"

import { playgroundTabs } from "../graphql/playground"

import authRouter from "./middlewares/auth-router"
import healthzHandler from "./middlewares/healthz"
import { sessionContext } from "./utils"

const graphqlLogger = baseLogger.child({
  module: "graphql",
})

const apolloConfig = getApolloConfig()

const jwtAlgorithms: jsonwebtoken.Algorithm[] = ["RS256"]

export const startApolloServer = async ({
  schema,
  port,
  startSubscriptionServer = false,
  type,
}: {
  schema: GraphQLSchema
  port: string | number
  startSubscriptionServer?: boolean
  type: string
}): Promise<Record<string, unknown>> => {
  const app = express()
  const httpServer = createServer(app)

  const apolloPlugins = [
    createComplexityPlugin({
      schema,
      estimators: [fieldExtensionsEstimator(), simpleEstimator({ defaultComplexity: 1 })],
      maximumComplexity: 200,
      onComplete: (complexity) => {
        baseLogger.debug({ complexity }, "queryComplexity")
      },
    }),
    ApolloServerPluginDrainHttpServer({ httpServer }),
    apolloConfig.playground
      ? ApolloServerPluginLandingPageGraphQLPlayground({
          settings: { "schema.polling.enable": false },
          tabs: [
            {
              endpoint: apolloConfig.playgroundUrl,
              ...playgroundTabs.default,
            },
          ],
        })
      : ApolloServerPluginLandingPageDisabled(),
  ]

  const apolloServer = new ApolloServer({
    schema,
    cache: "bounded",
    introspection: apolloConfig.playground,
    plugins: apolloPlugins,
    context: async (context) => {
      const tokenPayload = context.req.token

      const body = context.req?.body ?? null

      const ipString = isDev
        ? context.req?.ip
        : context.req?.headers["x-real-ip"] || context.req?.headers["x-forwarded-for"]

      const ip = parseIps(ipString)

      return sessionContext({
        tokenPayload,
        ip,
        body,
      })
    },
    formatError: (err) => {
      try {
        const reportErrorToClient =
          err instanceof ApolloError || err instanceof GraphQLError

        const reportedError = {
          message: err.message,
          locations: err.locations,
          path: err.path,
          code: err.extensions?.code,
        }

        return reportErrorToClient
          ? reportedError
          : { message: `Error processing GraphQL request ${reportedError.code}` }
      } catch (err) {
        throw mapError(err)
      }
    },
  })

  app.use("/auth", authRouter)

  const enablePolicy = apolloConfig.playground ? false : undefined

  app.use(
    helmet({
      crossOriginEmbedderPolicy: enablePolicy,
      crossOriginOpenerPolicy: enablePolicy,
      crossOriginResourcePolicy: enablePolicy,
      contentSecurityPolicy: enablePolicy,
    }),
  )

  // Health check
  app.get(
    "/healthz",
    healthzHandler({
      checkDbConnectionStatus: true,
      checkRedisStatus: true,
      checkLndsStatus: false,
    }),
  )

  app.use(
    PinoHttp({
      logger: graphqlLogger,
      wrapSerializers: false,
      autoLogging: {
        ignore: (req) => req.url === "/healthz",
      },
    }),
  )

  const secret = jwksRsa.expressJwtSecret(getJwksArgs()) as GetVerificationKey // https://github.com/auth0/express-jwt/issues/288#issuecomment-1122524366

  app.use(
    "/graphql",
    expressjwt({
      secret,
      algorithms: jwtAlgorithms,
      credentialsRequired: true,
      requestProperty: "token",
      issuer: "galoy.io",
    }),
  )

  await apolloServer.start()

  apolloServer.applyMiddleware({ app, path: "/graphql" })

  return new Promise((resolve, reject) => {
    httpServer.listen({ port }, () => {
      if (startSubscriptionServer) {
        const apolloSubscriptionServer = new SubscriptionServer(
          {
            execute: execute as unknown as ExecuteFunction,
            subscribe: subscribe as unknown as SubscribeFunction,
            schema,
            async onConnect(
              connectionParams: Record<string, unknown>,
              webSocket: unknown,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              connectionContext: any,
            ) {
              const { request } = connectionContext

              const authz = (connectionParams.authorization ||
                connectionParams.Authorization) as string | undefined
              // TODO: also manage the case where there is a cookie in the request

              // make request to oathkeeper
              const originalToken = authz?.slice(7) ?? undefined

              const newToken = await sendOathkeeperRequest(originalToken)
              // TODO: see how returning an error affect the websocket connection
              if (newToken instanceof Error) return newToken

              const keyJwks = await jwksRsa(getJwksArgs()).getSigningKey()

              const tokenPayload = jsonwebtoken.verify(newToken, keyJwks.getPublicKey(), {
                algorithms: jwtAlgorithms,
              })

              if (typeof tokenPayload === "string") {
                throw new Error("tokenPayload should be an object")
              }

              return sessionContext({
                tokenPayload,
                ip: request?.socket?.remoteAddress,

                // TODO: Resolve what's needed here
                body: null,
              })
            },
          },
          {
            server: httpServer,
            path: apolloServer.graphqlPath,
          },
        )
        ;["SIGINT", "SIGTERM"].forEach((signal) => {
          process.on(signal, () => apolloSubscriptionServer.close())
        })
      }

      console.log(
        `🚀 "${type}" server ready at http://localhost:${port}${apolloServer.graphqlPath}`,
      )
      resolve({ app, httpServer, apolloServer })
    })

    httpServer.on("error", (err) => {
      console.error(err)
      reject(err)
    })
  })
}
