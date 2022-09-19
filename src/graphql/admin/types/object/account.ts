import { getDefaultAccountsConfig } from "@config"

import { Accounts, Users, Wallets } from "@app"

import { CouldNotFindError } from "@domain/errors"
import { NoAccountCustomFieldsError } from "@domain/accounts"

import { GT } from "@graphql/index"
import { GraphQLObjectType } from "graphql"
import Wallet from "@graphql/types/abstract/wallet"
import Username from "@graphql/types/scalar/username"
import Timestamp from "@graphql/types/scalar/timestamp"
import Coordinates from "@graphql/types/object/coordinates"

import AccountLevel from "../scalar/account-level"
import AccountStatus from "../scalar/account-status"

import GraphQLUser from "./user"
import AccountCustomFields from "./account-custom-fields"

const { customFields } = getDefaultAccountsConfig()

const Account: GraphQLObjectType<Account> = GT.Object<Account>({
  name: "Account",
  description:
    "Accounts are core to the Galoy architecture. they have users, and own wallets",
  fields: () => {
    const fields = {
      id: { type: GT.NonNullID },
      username: { type: Username },
      level: { type: GT.NonNull(AccountLevel) },
      status: { type: GT.NonNull(AccountStatus) },
      title: { type: GT.String },
      wallets: {
        type: GT.NonNullList(Wallet),
        resolve: async (source: Account) => {
          return Wallets.listWalletsByAccountId(source.id)
        },
      },
      owner: {
        // should be used for individual account only,
        // ie: when there are no multiple users
        // probably separating AccountDetail to DetailConsumerAccount
        // with DetailCorporateAccount is a way to have owner only in DetailConsumerAccount
        // and users: [Users] in DetailCorporateAccount

        type: GT.NonNull(GraphQLUser),
        resolve: async (source: Account) => {
          const user = await Users.getUser(source.ownerId)
          if (user instanceof Error) {
            throw user
          }

          return user
        },
      },
      coordinates: {
        type: Coordinates,
        description:
          "GPS coordinates for the account that can be used to place the related business on a map",
      },
      createdAt: {
        type: GT.NonNull(Timestamp),
        resolve: (source: Account) => source.createdAt,
      },
    }

    if (customFields && customFields.length > 0) {
      return Object.assign(fields, {
        customFields: {
          type: AccountCustomFields,
          resolve: async (source: Account) => {
            const accountCustomFields = await Accounts.getAccountCustomFields(source.id)
            if (accountCustomFields instanceof CouldNotFindError) return null
            if (accountCustomFields instanceof NoAccountCustomFieldsError) return null
            if (accountCustomFields instanceof Error) throw accountCustomFields

            return accountCustomFields.customFields
          },
        },
      })
    }

    return fields
  },
})

export default Account
