/** Cart operations built from the existing /cart API contract. */
import { cart as cartApi } from '../../../services/api/endpoints.js'

const asCartRows = (value) => {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.data)) return value.data
  if (Array.isArray(value?.result)) return value.result
  if (Array.isArray(value?.cart)) return value.cart
  throw { error: 'The server returned an invalid cart response.' }
}

/**
 * Clear the current buyer's server cart in one backend operation.
 */
export async function clearServerCart() {
  return cartApi.clear()
}
