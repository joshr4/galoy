type SwapClientReadableStream<T> = import("@grpc/grpc-js").ClientReadableStream<T>
type SwapServiceError = import("./errors").SwapServiceError
type SwapType = import("./index").SwapType
type SwapProvider = import("./index").SwapProvider
type SwapState = import("./index").SwapState
// TODO remove dependency and create SwapStatus Type
type LoopSwapStatus =
  import("@services/swap/providers/lightning-labs/protos/loop_pb").SwapStatus
interface ISwapService {
  healthCheck: () => Promise<boolean>
  swapOut: (amount: Satoshis) => Promise<SwapOutResult | SwapServiceError>
  swapListener: () => SwapClientReadableStream<SwapListenerResponse>
  swapOutTerms?: () => Promise<string> // TODO: Implement this
  swapOutQuote?: () => Promise<string> // TODO: Implement this
}

type SwapOutResult = {
  swapId: string
  swapIdBytes: string
  htlcAddress: string
  serverMessage: string
}

type SwapListenerResponse =
  | (LoopSwapStatus & SwapStatusResultWrapper)
  | (SwapStatusResult & SwapStatusResultWrapper)
  | SwapServiceError

type SwapStatusResultWrapper = {
  parsedSwapData?: SwapStatusResult
}

type SwapStatusResult = {
  amt: bigint
  id: string
  state: SwapState
  htlcAddress: string
  serviceProviderFee: bigint
  onchainMinerFee: bigint
  offchainRoutingFee: bigint
  message: string
  swapType: SwapType
}

type SwapConfig = {
  minOnChainHotWalletBalance: Satoshis
  swapOutAmount: Satoshis
  lnd1loopRestEndpoint: string
  lnd2loopRestEndpoint: string
  lnd1loopRpcEndpoint: string
  lnd2loopRpcEndpoint: string
  swapProviders: Array<SwapProvider>
}
