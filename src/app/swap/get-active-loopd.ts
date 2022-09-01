import { getActiveOnchainLnd } from "@services/lnd/utils"
import { SwapErrorNoActiveLoopdNode } from "@domain/swap/errors"
import {
  BTC_NETWORK,
  getSwapConfig,
  LND1_LOOP_MACAROON,
  LND1_LOOP_TLS,
  LND2_LOOP_MACAROON,
  LND2_LOOP_TLS,
} from "@config"
import { LoopdInstanceName } from "@domain/swap"

export const getActiveLoopd = (): LoopdConfig => {
  const activeNode = getActiveOnchainLnd()
  if (activeNode instanceof Error) throw SwapErrorNoActiveLoopdNode
  switch (activeNode.name) {
    case "LND1": {
      return LND1_LOOP_CONFIG
    }
    case "LND2": {
      return LND2_LOOP_CONFIG
    }
    default: {
      return LND1_LOOP_CONFIG
    }
  }
}

export const LND1_LOOP_CONFIG: LoopdConfig = {
  btcNetwork: BTC_NETWORK,
  grpcEndpoint: getSwapConfig().lnd1loopRpcEndpoint,
  tlsCert: LND1_LOOP_TLS,
  macaroon: LND1_LOOP_MACAROON,
  loopdInstanceName: LoopdInstanceName.LND1_LOOP,
}

export const LND2_LOOP_CONFIG: LoopdConfig = {
  btcNetwork: BTC_NETWORK,
  grpcEndpoint: getSwapConfig().lnd2loopRpcEndpoint,
  tlsCert: LND2_LOOP_TLS,
  macaroon: LND2_LOOP_MACAROON,
  loopdInstanceName: LoopdInstanceName.LND2_LOOP,
}
