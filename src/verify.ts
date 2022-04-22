import parseAsHeaders from 'parse-headers'
import { Buffer } from 'buffer'
import Loader from './loader'
const { Base64 } = require('js-base64')

const DEBUG = true // !!process.env.DEBUG_WEB3

function parseToken(base64Decoded: string) {
  try {
    const { signature, body, key } = JSON.parse(base64Decoded)
    return { signature, body, key }
  } catch (error) {
    throw new Error('Token malformed (unparsable JSON)')
  }
}

export const verify = async (token: string) => {
  // Check: does token exist?
  if (!token || !token.length) {
    throw new Error('Token required.')
  }

  // Decode token from base64
  let base64Decoded
  try {
    base64Decoded = Base64.decode(token)
  } catch (error) {
    throw new Error('Token malformed (must be base64 encoded)')
  }

  // Check: is token malformed?
  if (!base64Decoded || !base64Decoded.length) {
    throw new Error('Token malformed (must be base64 encoded)')
  }

  // Parse token into signature & body
  const { signature, body, key } = parseToken(base64Decoded)

  console.log(key)

  // Check: is body malformed?
  if (!body || !body.length) {
    throw new Error('Token malformed (empty message)')
  }

  // Check: is signature malformed?
  if (!signature || !signature.length) {
    throw new Error('Token malformed (empty signature)')
  }

  // Load dynamic Cardano libs
  await Loader.load()

  // @ts-ignore
  const message = Loader.Message.COSESign1.from_bytes(Buffer.from(Buffer.from(signature, 'hex'), 'hex'))

  log('message', message)

  const headermap = message.headers().protected().deserialized_headers()

  const address = Loader.Cardano.Address.from_bytes(
    headermap.header(Loader.Message.Label.new_text('address')).as_bytes(),
  )

  const coseKey = Loader.Message.COSEKey.from_bytes(Buffer.from(key, 'hex'))

  const publicKey = Loader.Cardano.PublicKey.from_bytes(
    coseKey
      .header(Loader.Message.Label.new_int(Loader.Message.Int.new_negative(Loader.Message.BigNum.from_str('2'))))
      .as_bytes(),
  )

  log('publicKey', Buffer.from(publicKey.as_bytes()).toString('hex'))
  const verifyAddressResponse = verifyAddress(address, publicKey)

  if (!verifyAddressResponse.status) {
    throw new Error(`Address verification failed: (${verifyAddressResponse.msg} (${verifyAddressResponse.code}))`)
  }

  const data = message.signed_data().to_bytes()
  const bodyFromToken = Buffer.from(data).toString('utf-8')

  const ed25519Sig = Loader.Cardano.Ed25519Signature.from_bytes(message.signature())

  if (!publicKey.verify(data, ed25519Sig)) {
    throw new Error(`Message integrity check failed (has the message been tampered with?)`)
  }

  const parsedBody: any = parseAsHeaders(bodyFromToken)

  if (parsedBody['expire-date'] && new Date(parsedBody['expire-date']) < new Date()) {
    throw new Error('Token expired')
  }

  return {
    address: address.to_bech32(),
    network: address.network_id(),
    body: parsedBody,
  }
}

/**
 * Validate the Address provided. To do this we take the Address (or Base Address)
 * and compare it to an address (BaseAddress or RewardAddress) reconstructed from the
 * publicKey.
 * @param {Loader.Cardano.Address} checkAddress
 * @param {Loader.Cardano.PublicKey} publicKey
 * @returns {{status: bool, msg?: string, code?: number}}
 */
const verifyAddress = (checkAddress: any, publicKey: any) => {
  log('In verifyAddress', checkAddress, publicKey)
  let errorMsg = ''
  try {
    //reconstruct address
    log('Step verifyAddress', 1)
    const paymentKeyHash = publicKey.hash()

    log('Step verifyAddress', 2)
    const baseAddress = Loader.Cardano.BaseAddress.from_address(checkAddress)
    const stakeKeyHash = baseAddress.stake_cred().to_keyhash()
    log('Step verifyAddress', 3)
    const reconstructedAddress = Loader.Cardano.BaseAddress.new(
      checkAddress.network_id(),
      Loader.Cardano.StakeCredential.from_keyhash(paymentKeyHash),
      Loader.Cardano.StakeCredential.from_keyhash(stakeKeyHash),
    )
    log('Step verifyAddress', 4)

    const status = checkAddress.to_bech32() === reconstructedAddress.to_address().to_bech32()
    log('Step verifyAddress', 5, status)
    return {
      status,
      msg: status ? 'Valid Address' : 'Base Address does not validate to Reconstructed address',
      code: 1,
    }
  } catch (e: any) {
    log('Err verifyAddress', e)
    errorMsg += ` ${e.message}`
  }

  return {
    status: false,
    msg: `Error: ${errorMsg}`,
    code: 3,
  }
}

function log(message: string, ...optionalParams: any) {
  if (DEBUG) console.log(message, optionalParams)
}
