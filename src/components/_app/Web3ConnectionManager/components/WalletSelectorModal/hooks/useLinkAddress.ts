import { useUserPublic } from "components/[guild]/hooks/useUser"
import useWeb3ConnectionManager from "components/_app/Web3ConnectionManager/hooks/useWeb3ConnectionManager"
import {
  AddressLinkParams,
  addressLinkParamsAtom,
} from "components/common/Layout/components/Account/components/AccountModal/components/LinkAddressButton"
import { randomBytes } from "crypto"
import useKeyPair from "hooks/useKeyPair"
import { deleteKeyPairFromIdb, getKeyPairFromIdb } from "hooks/useSetKeyPair"
import useSubmit from "hooks/useSubmit"
import { useAtom } from "jotai"
import { useEffect } from "react"
import { mutate } from "swr"
import { fetcherWithSign } from "utils/fetcher"

const getAddressLinkProof = async (
  address: `0x${string}`,
  signMessage: (message: string) => Promise<string>
) => {
  const addr = address.toLowerCase()
  const timestamp = Date.now()
  const nonce = randomBytes(32).toString("hex")
  const message = `Address: ${addr}\nNonce: ${nonce}\n Timestamp: ${timestamp}`
  const signature = await signMessage(message)

  return { address: addr, nonce, timestamp, signature }
}

const checkAndDeleteKeys = async (userId: number) => {
  const keys = await getKeyPairFromIdb(userId)
  if (!keys) return
  await deleteKeyPairFromIdb(userId)
}
const useLinkAddress = () => {
  const { signMessage, address: addressToLink } = useWeb3ConnectionManager()
  const [addressLinkParams, setAddressLinkParams] = useAtom(addressLinkParamsAtom)
  const { id: currentUserId } = useUserPublic()
  const { deleteKeyOfUser } = useKeyPair()

  // When we link an address, that has a registered keypair, we need to delete that keypair to trigger the modal. Plus that keys are invalidated anyway, and would end up sitting in the indexeddb util they are manually deleted
  useEffect(() => {
    if (
      !addressLinkParams?.userId ||
      !currentUserId ||
      addressLinkParams.userId === currentUserId
    )
      return

    checkAndDeleteKeys(currentUserId).then(() => deleteKeyOfUser())
  }, [addressLinkParams, currentUserId])

  return useSubmit(async ({ userId, address }: AddressLinkParams) => {
    const keys = await getKeyPairFromIdb(userId)
    if (!keys || !keys.keyPair) {
      throw new Error(
        "Failed to link address, please refresh the page and try again"
      )
    }

    const body = await getAddressLinkProof(addressToLink, signMessage)

    const newAddress = await fetcherWithSign(
      {
        address,
        keyPair: keys.keyPair,

        // TODO: Proper method-based typing would be nice, so we wouldn't have to pass these
        walletClient: undefined,
        chainId: undefined,
        publicClient: undefined,
      },
      `/v2/users/${userId}/addresses`,
      { method: "POST", body }
    )

    // Update signed profile data with new address
    await mutate(
      [`/v2/users/${userId}/profile`, { method: "GET", body: {} }],
      (prev) => ({
        ...(prev ?? {}),
        addresses: [...(prev?.addresses ?? []), newAddress],
      }),
      { revalidate: false }
    )

    // The address is now associated with the other user
    await mutate(
      `/v2/users/${addressToLink}/profile`,
      {
        id: userId,
        publicKey: keys.pubKey,
        captchaVerifiedSince: new Date().toISOString(), // We don't necessarily know this, but the user has to be verified because of the main user. So we are just setting this to the current date, so the app knows the user is verified
      },
      { revalidate: false }
    )

    setAddressLinkParams({ userId: undefined, address: undefined })
  })
}

export default useLinkAddress
