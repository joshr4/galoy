import { getDefaultAccountsConfig } from "@config"

import { NoAccountCustomFieldsError } from "@domain/accounts"

import { AccountCustomFieldsRepository } from "@services/mongoose"

const { customFields: customFieldsSchema } = getDefaultAccountsConfig()

export const getAccountCustomFields = async (
  accountId: AccountId,
): Promise<AccountCustomFields | ApplicationError> => {
  if (!customFieldsSchema || customFieldsSchema.length <= 0)
    return new NoAccountCustomFieldsError()

  return AccountCustomFieldsRepository().findById(accountId)
}
