import cors from "cors"
import express from "express"

import * as jwt from "jsonwebtoken"

import { Users } from "@app"
import { getKratosConfig, isDev, JWT_SECRET } from "@config"
import { parseIps } from "@domain/users-ips"
import { mapError } from "@graphql/error-map"
import { baseLogger } from "@services/logger"

import { kratosPublic } from "@services/kratos"

const graphqlLogger = baseLogger.child({
  module: "graphql",
})

const authRouter = express.Router({ caseSensitive: true })

// TODO: why is cors origin policies mapped to kratos config?
const { corsAllowedOrigins } = getKratosConfig()

authRouter.use(cors({ origin: corsAllowedOrigins, credentials: true }))

authRouter.post("/browser", async (req, res) => {
  const ipString = isDev ? req?.ip : req?.headers["x-real-ip"]
  const ip = parseIps(ipString)

  if (ip === undefined) {
    throw new Error("IP is not defined")
  }

  const logger = graphqlLogger.child({ ip, body: req.body })

  try {
    const { data } = await kratosPublic.toSession(undefined, req.header("Cookie"))

    const kratosLoginResp = await Users.loginWithEmail({
      kratosUserId: data.identity.id,
      emailAddress: data.identity.traits.email,
      logger,
      ip,
    })

    if (kratosLoginResp instanceof Error) {
      return res.send({ error: mapError(kratosLoginResp) })
    }

    res.send({ kratosUserId: data.identity.id, ...kratosLoginResp })
  } catch (error) {
    res.send({ error: "Browser auth error" })
  }
})

const jwtAlgorithms: jwt.Algorithm[] = ["HS256"]

// used by oathkeeper to validate JWT
// should not be public
authRouter.post("/validatejwt", async (req, res) => {
  const headers = req?.headers
  let tokenPayload: string | jwt.JwtPayload | null = null
  const authz = headers.authorization || headers.Authorization
  if (authz) {
    try {
      const rawToken = authz.slice(7) as string

      tokenPayload = jwt.verify(rawToken, JWT_SECRET, {
        algorithms: jwtAlgorithms,
      })
    } catch (err) {
      res.status(401).send({ error: "Token validation error" })
      return
    }
  }

  if (typeof tokenPayload === "string") {
    throw new Error("tokenPayload should be an object")
  }

  if (!tokenPayload) {
    res.status(401).send({ error: "Token validation error" })
    return
  }

  // the sub (subject) sent to oathkeeper as a response is the uid from the original token
  // which is the AccountId
  res.json({ sub: tokenPayload.uid })
})

export default authRouter
