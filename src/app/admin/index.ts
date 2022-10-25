import { checkedToUsername } from "@domain/accounts"
import { AccountsRepository } from "@services/mongoose"
import { UsersRepository } from "@services/mongoose/users"

export const getAccountByUsername = async (username: string) => {
  const usernameValid = checkedToUsername(username)
  if (usernameValid instanceof Error) return usernameValid

  const accounts = AccountsRepository()
  return accounts.findByUsername(usernameValid)
}

export const getAccountByUserPhone = async (phone: PhoneNumber) => {
  const user = await UsersRepository().findByPhone(phone)
  if (user instanceof Error) return user

  const accounts = AccountsRepository()
  return accounts.findByKratosUserId(user.id)
}
