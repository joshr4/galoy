import { intraledgerPaymentSend } from "@app/lightning"
import { getUsernameFromWalletPublicId } from "@app/users"
import { checkedToWalletPublicId } from "@domain/wallets"
import { GT } from "@graphql/index"

import PaymentSendPayload from "@graphql/types/payload/payment-send"
import Memo from "@graphql/types/scalar/memo"
import SatAmount from "@graphql/types/scalar/sat-amount"
import WalletId from "@graphql/types/scalar/wallet-id"

const IntraLedgerPaymentSendInput = new GT.Input({
  name: "IntraLedgerPaymentSendInput",
  fields: () => ({
    recipientWalletId: { type: GT.NonNull(WalletId) },
    amount: { type: GT.NonNull(SatAmount) },
    memo: { type: Memo },
  }),
})

const IntraLedgerPaymentSendMutation = GT.Field({
  type: GT.NonNull(PaymentSendPayload),
  args: {
    input: { type: GT.NonNull(IntraLedgerPaymentSendInput) },
  },
  resolve: async (_, args, { user, wallet, logger }) => {
    const { recipientWalletId, amount, memo } = args.input
    for (const input of [recipientWalletId, amount, memo]) {
      if (input instanceof Error) {
        return { errors: [{ message: input.message }] }
      }
    }

    const walletPublicId = checkedToWalletPublicId(recipientWalletId)
    if (walletPublicId instanceof Error) {
      return { errors: [{ message: walletPublicId.message }] }
    }

    const recipientUsername = await getUsernameFromWalletPublicId(walletPublicId)
    if (recipientUsername instanceof Error) {
      return { errors: [{ message: recipientUsername.message }] }
    }

    try {
      const status = await intraledgerPaymentSend({
        recipientUsername,
        memo,
        amount,
        walletId: wallet.user.id,
        userId: user.id,
        logger,
      })
      if (status instanceof Error) {
        return { status: "failed", errors: [{ message: status.message }] }
      }

      return {
        errors: [],
        status: status.value,
      }
    } catch (err) {
      return {
        status: "failed",
        errors: [{ message: err.message }],
      }
    }
  },
})

export default IntraLedgerPaymentSendMutation
