import dedent from "dedent"

import { GT } from "@graphql/index"

import { SettlementMethod } from "@domain/wallets"

import WalletId from "../scalar/wallet-id"
import Username from "../scalar/username"
import OnChainTxHash from "../scalar/onchain-tx-hash"
import LnPaymentPreImage from "../scalar/ln-payment-preimage"

const SettlementViaIntraLedgerWithMetadata = GT.Object({
  name: "SettlementViaIntraLedgerWithMetadata",
  isTypeOf: (source) => source.type === SettlementMethod.IntraLedger,
  fields: () => ({
    counterPartyWalletId: {
      // TODO: uncomment below after db migration
      // type: GT.NonNull(WalletId),
      type: WalletId,
    },
    counterPartyUsername: {
      type: Username,
      description: dedent`Settlement destination: Could be null if the payee does not have a username`,
    },
  }),
})

const SettlementViaLnWithMetadata = GT.Object({
  name: "SettlementViaLnWithMetadata",
  isTypeOf: (source: SettlementViaLnWithMetadata) =>
    source.type === SettlementMethod.Lightning,
  fields: () => ({
    preImage: {
      type: LnPaymentPreImage,
      resolve: (source: SettlementViaLnWithMetadata) => source.revealedPreImage,
    },
  }),
})

const SettlementViaOnChainWithMetadata = GT.Object({
  name: "SettlementViaOnChainWithMetadata",
  isTypeOf: (source) => source.type === SettlementMethod.OnChain,
  fields: () => ({
    transactionHash: {
      type: GT.NonNull(OnChainTxHash),
    },
  }),
})

const SettlementViaWithMetadata = GT.Union({
  name: "SettlementViaWithMetadata",
  types: () => [
    SettlementViaIntraLedgerWithMetadata,
    SettlementViaLnWithMetadata,
    SettlementViaOnChainWithMetadata,
  ],
})

export default SettlementViaWithMetadata
