import { createServer } from "http"
import crypto from "crypto"

import { Accounts, Users } from "@app"
import { getApolloConfig, getGeetestConfig, isDev, isProd, JWT_SECRET } from "@config"
import Geetest from "@services/geetest"
import { baseLogger } from "@services/logger"
import {
  ACCOUNT_USERNAME,
  addAttributesToCurrentSpan,
  addAttributesToCurrentSpanAndPropagate,
  SemanticAttributes,
} from "@services/tracing"
import {
  ApolloServerPluginDrainHttpServer,
  ApolloServerPluginLandingPageDisabled,
  ApolloServerPluginLandingPageGraphQLPlayground,
  ApolloServerPluginUsageReporting,
} from "apollo-server-core"
import { ApolloError, ApolloServer } from "apollo-server-express"
import express from "express"
import { GraphQLError, GraphQLSchema } from "graphql"
import { useServer } from "graphql-ws/lib/use/ws"
import helmet from "helmet"
import * as jwt from "jsonwebtoken"
import PinoHttp from "pino-http"
import { WebSocketServer } from "ws"

import { mapError } from "@graphql/error-map"

import { parseIps } from "@domain/users-ips"

import { playgroundTabs } from "../graphql/playground"

import healthzHandler from "./middlewares/healthz"

const graphqlLogger = baseLogger.child({
  module: "graphql",
})

const apolloConfig = getApolloConfig()

const GRAPHQL_PATH = "/graphql"

const jwtAlgorithms: jwt.Algorithm[] = ["HS256"]

const geeTestConfig = getGeetestConfig()
const geetest = Geetest(geeTestConfig)

const sessionContext = ({
  tokenPayload,
  ip,
  body,
}: {
  tokenPayload: jwt.JwtPayload | null
  ip: IpAddress | undefined
  body: unknown
}): Promise<GraphQLContext> => {
  const userId = tokenPayload?.uid ?? null

  // TODO move from crypto.randomUUID() to a Jaeger standard
  const logger = graphqlLogger.child({ tokenPayload, id: crypto.randomUUID(), body })

  let domainUser: User | null = null
  let domainAccount: Account | undefined
  return addAttributesToCurrentSpanAndPropagate(
    {
      [SemanticAttributes.ENDUSER_ID]: userId,
      [SemanticAttributes.HTTP_CLIENT_IP]: ip,
    },
    async () => {
      if (userId) {
        const loggedInUser = await Users.getUserForLogin({ userId, ip, logger })
        if (loggedInUser instanceof Error)
          throw new ApolloError("Invalid user authentication", "INVALID_AUTHENTICATION", {
            reason: loggedInUser,
          })
        domainUser = loggedInUser

        const loggedInDomainAccount = await Accounts.getAccount(
          domainUser.defaultAccountId,
        )
        if (loggedInDomainAccount instanceof Error) throw Error
        domainAccount = loggedInDomainAccount
      }

      addAttributesToCurrentSpan({ [ACCOUNT_USERNAME]: domainAccount?.username })

      return {
        logger,
        uid: userId,
        // FIXME: we should not return this for the admin graphql endpoint
        domainUser,
        domainAccount,
        geetest,
        ip,
      }
    },
  )
}

export const startSubscription = async ({
  schema,
  port,
  enableApolloUsageReporting = false,
  type,
}: {
  // TODO: Schema needs to be edited. only expose subscription.
  schema: GraphQLSchema
  port: string | number
  enableApolloUsageReporting?: boolean
  type: string
}): Promise<Record<string, unknown>> => {
  const app = express()
  const httpServer = createServer(app)

  const apolloPlugins = [
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

  if (isProd && enableApolloUsageReporting) {
    apolloPlugins.push(
      ApolloServerPluginUsageReporting({
        rewriteError(err) {
          graphqlLogger.error(err, "Error caught in rewriteError")
          return err
        },
      }),
    )
  }

  const wsServer = new WebSocketServer({
    server: httpServer,
    path: GRAPHQL_PATH,
  })

  const serverCleanup = useServer(
    {
      schema,
      // onConnect: // TODO: if token is present, but jwt.verify fails, close connection
      context: (ctx) => {
        const connectionParams = ctx.connectionParams as Record<string, string>

        // TODO: check if nginx pass the ip to the header
        // TODO: ip not been used currently for subscription.
        // implement some rate limiting.
        const ipString = isDev
          ? connectionParams?.ip
          : connectionParams?.["x-real-ip"] || connectionParams?.["x-forwarded-for"]

        const ip = parseIps(ipString)

        if (connectionParams) {
          let tokenPayload: string | jwt.JwtPayload | null = null
          const authz =
            (connectionParams.authorization as string) ||
            (connectionParams.Authorization as string)
          if (authz) {
            const rawToken = authz.slice(7)
            tokenPayload = jwt.verify(rawToken, JWT_SECRET, {
              algorithms: jwtAlgorithms,
            })
            if (typeof tokenPayload === "string") {
              throw new Error("tokenPayload should be an object")
            }
          }
          return sessionContext({
            tokenPayload,

            ip,
            // TODO: Resolve what's needed here
            body: null,
          })
        }
      },
    },
    wsServer,
  )

  ;["SIGINT", "SIGTERM"].forEach((signal) => {
    process.on(signal, () => wsServer.close())
  })

  apolloPlugins.push({
    async serverWillStart() {
      return {
        async drainServer() {
          await serverCleanup.dispose()
        },
      }
    },
  })

  const apolloServer = new ApolloServer({
    schema,
    plugins: apolloPlugins,
    introspection: apolloConfig.playground,

    // if this subscription only?
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
        return mapError(err)
      }
    },
  })

  const enablePolicy = apolloConfig.playground ? false : undefined

  app.use(
    helmet({
      crossOriginEmbedderPolicy: enablePolicy,
      crossOriginOpenerPolicy: enablePolicy,
      crossOriginResourcePolicy: enablePolicy,
      contentSecurityPolicy: enablePolicy,
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

  // Health check
  app.get(
    "/healthz",
    healthzHandler({
      checkDbConnectionStatus: true,
      checkRedisStatus: true,
      checkLndsStatus: false,
    }),
  )

  await apolloServer.start()

  apolloServer.applyMiddleware({ app, path: GRAPHQL_PATH })

  return new Promise((resolve, reject) => {
    httpServer.listen({ port }, () => {
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
