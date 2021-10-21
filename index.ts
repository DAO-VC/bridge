import admin from "firebase-admin";
import credentials from "./credentials.json";
const db = admin.initializeApp({ credential: admin.credential.cert(credentials as any) }).firestore();

import { providers, Wallet, Contract, BigNumber, utils } from "ethers";
import { TransactionReceipt } from "web3-core";
import axios from "axios";

import TokenAbi from "./abis/Token.json";
import BridgeAssist from "./abis/BridgeAssist.json";
import walletPrivateKey from "./secret"; // controlling wallet private key
const infuraKey = '9f8f17dac08b4224b39387cf2867a68a'
const address_BABE = '0x3Ab0B2683a8e3828aA3841A7F013588651C6E865'
const address_BABX = '0x710BEADcBb28eF8991f74ccb7e214f00D37bd1E7'
const address_BAEB = '0x199764249052B3A5935bD7D2E9c603457D3BfA24'
const address_BAEX = '0x0B43BEEa48A89b5d34Ce997f1D4a3E3A31881959'
const address_BAXB = '0x837E7DA329bdd91a5005DdA93C8f076640D4b214'
const address_BAXE = '0x547e9337C88ADFe32C2A9e5273F281b813FB085D'

const address_TKNX = '0x77c52a86dc68C1E0C906244031e13Bf7b69828a1'
const address_TKNE = '0x284b59cf2539544559C6EfA11E2795e06D535345'
const address_TKNB = '0xaB6B429C73C22EcAbC763635DAce7efAC524993c'
const _providerE = new providers.InfuraProvider(1, infuraKey) // tuta 1 --3
const _providerB = new providers.JsonRpcProvider('https://bsc-dataseed1.defibit.io/') // tuta https://bsc-dataseed.binance.org/  --https://data-seed-prebsc-1-s1.binance.org:8545/
const _providerX = new providers.JsonRpcProvider('https://rpc-mainnet.maticvigil.com/') // tuta https://rpc-mainnet.matic.network  --https://rpc-mumbai.matic.today


const signerB = new Wallet(walletPrivateKey, _providerB);
const signerE = new Wallet(walletPrivateKey, _providerE);
const signerX = new Wallet(walletPrivateKey, _providerX);
const TKNE = new Contract(address_TKNE, TokenAbi.abi, _providerE)
const TKNB = new Contract(address_TKNB, TokenAbi.abi, _providerB)
const TKNX = new Contract(address_TKNX, TokenAbi.abi, _providerX)
const BABE = new Contract(address_BABE, BridgeAssist.abi, _providerB);
const BABX = new Contract(address_BABX, BridgeAssist.abi, _providerB);
const BAEB = new Contract(address_BAEB, BridgeAssist.abi, _providerE);
const BAEX = new Contract(address_BAEX, BridgeAssist.abi, _providerE);
const BAXE = new Contract(address_BAXE, BridgeAssist.abi, _providerX);
const BAXB = new Contract(address_BAXB, BridgeAssist.abi, _providerX);

const latestNonces = { B: 0, E: 0, X: 0 };
// queues and buffer lifetime
const TIME_QUEUE = 120000;
const TIME_PARAMS = 30000;
const TIME_PRICE = 30000;

import bunyan from "bunyan";
import { LoggingBunyan } from "@google-cloud/logging-bunyan";
const loggingBunyan = new LoggingBunyan();
const logger = bunyan.createLogger({ name: "my-service", streams: [loggingBunyan.stream("debug")] });

// Info Buffers
type DirectionType = "BE" | "BX" | "EB" | "EX" | "XB" | "XE";
type ChangeableParams = { CTF: number; FTM: number; PSD: boolean };
type PricesBuffer = { date: number; prices: { TEP: number; TBP: number; TXP: number } };
type CostBuffer = { date: number; cost: BigNumber };
let paramsBuffer = { date: 0, params: { CTF: 200, FTM: 200, PSD: false } as ChangeableParams };
let costBuffers = {
  BE: { date: 0, cost: BigNumber.from(0) },
  BX: { date: 0, cost: BigNumber.from(0) },
  EB: { date: 0, cost: BigNumber.from(0) },
  EX: { date: 0, cost: BigNumber.from(0) },
  XB: { date: 0, cost: BigNumber.from(0) },
  XE: { date: 0, cost: BigNumber.from(0) },
} as { [key in DirectionType]: CostBuffer };
let EGPBuffer = { date: 0, GP: BigNumber.from(0) };
let BGPBuffer = { date: 0, GP: BigNumber.from(0) };
let XGPBuffer = { date: 0, GP: BigNumber.from(0) };
let pricesBuffer = { date: 0, prices: { TEP: 0, TBP: 0, TXP: 0 } } as PricesBuffer;

function removeTrailingZeros(str: string): string {
  if (str === "0") return str;
  if (str.slice(-1) === "0") return removeTrailingZeros(str.substr(0, str.length - 1));
  if (str.slice(-1) === ".") return str.substr(0, str.length - 1);
  return str;
}
function BNToNumstr(bn: BigNumber | string, dec: number, prec: number): string {
  const str = bn.toString();
  if (str === "0") return str;
  if (isNaN(Number(str))) return "NaN";
  if (str.length <= dec) return removeTrailingZeros(("0." + "000000000000000000".substr(0, dec - str.length) + str).substr(0, dec - str.length + prec + 2));
  else return removeTrailingZeros([(str.substr(0, str.length - dec), str.slice(-dec))].join(".").substr(0, str.length - dec + prec + 1));
}

async function loadChangeableParams() {
  if (Date.now() - paramsBuffer.date < TIME_PARAMS) return paramsBuffer.params;
  try {
    const params = (await db.collection("config").doc("changeables").get()).data() as ChangeableParams | undefined;
    if (!params) throw new Error("Could not get config from firestore");
    paramsBuffer = { date: Date.now(), params };
    return params;
  } catch (error) {
    throw new Error(`Could not load params: ${error.message}`);
  }
}
async function writeQueue(direction: DirectionType, address: string) {
  try {
    await db.collection(`queue${direction[0]}`).doc(address).create({ date: Date.now() });
  } catch (error) {
    throw new Error(`Could not write to queue: ${error.reason || error.message}`);
  }
}
async function clearQueue(direction: DirectionType, address: string) {
  try {
    await db.collection(`queue${direction[0]}`).doc(address).delete();
  } catch (error) {
    throw new Error(`Could not clear queue: ${error.reason || error.message}`);
  }
}
async function assertQueue(direction: DirectionType, address: string) {
  let entry: any;
  try {
    entry = (await db.collection(`queue${direction[0]}`).doc(address).get()).data();
  } catch (error) {
    throw new Error(`Could not check request queue: ${error.reason || error.message}`);
  }
  if (entry) {
    if (Date.now() - entry.date < TIME_QUEUE) throw new Error(`Request done recently: timeout is 2min`);
    else await db.collection(`queue${direction[0]}`).doc(address).delete(); // if it was left undeleted since last time
  }
}

async function getPrices() {
  if (Date.now() - pricesBuffer.date < TIME_PRICE) return pricesBuffer.prices;
  try {
    const { data } = (await axios.get(`https://api.kucoin.com/api/v1/prices?currencies=MATIC,ETH,BNB`)).data as {
      code: "200000";
      data: { BNB: string; ETH: string; MATIC: string };
    };
    if (!data || !data.BNB || !data.ETH || !data.MATIC) throw new Error("Kucoin exchange price data invalid");
    const XU = Number(data.MATIC);
    const BU = Number(data.BNB);
    const EU = Number(data.ETH);
    const TU = 0.1;
    const TEP = TU / EU;
    const TBP = TU / BU;
    const TXP = TU / XU;
    const prices = { TBP, TEP, TXP };
    pricesBuffer = { date: Date.now(), prices };
    console.log({ data, prices });
    return prices;
  } catch (error) {
    throw new Error(`Could not get prices: ${error.reason || error.message}`);
  }
}
// Calculate Cost
function _calcCost(gas: BigNumber, gasPrice: BigNumber, tknPrice: number, decimals: number) {
  
  const res = gasPrice
    .mul(gas)
    .mul(1e8)
    .div(Math.trunc(tknPrice * 1e8))
    .div(10 ** (18 - decimals));
    console.log(`gas ${gas}, gasPrice ${gasPrice}, tknPrice ${tknPrice}, decimals ${decimals}, res ${res}`);
    return res;
}
function calcCost(CG: BigNumber, CGP: BigNumber, TCP: number, CD: number, DG: BigNumber, DGP: BigNumber, TDP: number, DD: number) {
  return _calcCost(CG, CGP, TCP, CD).add(_calcCost(DG, DGP, TDP, DD));
}
// Get ETH Gas Price x1.2
async function _getEGP() {
  if (Date.now() - EGPBuffer.date < TIME_PRICE) return EGPBuffer.GP;
  try {
    let GP = (await _providerE.getGasPrice()).mul(120).div(100);
    if (GP.lt(40e9)) GP = BigNumber.from(40e9);
    EGPBuffer = { date: Date.now(), GP };
    console.log(`EGP ${GP}`);
    return GP;
  } catch (error) {
    throw new Error(`Could not get ETH gas price: ${error.reason || error.message}`);
  }
}
async function _getBGP() {
  if (Date.now() - BGPBuffer.date < TIME_PRICE) return BGPBuffer.GP;
  try {
    const BGP = await _providerB.getGasPrice();
    BGPBuffer = { date: Date.now(), GP: BGP };
    console.log(`BGP ${BGP}`)
    return BGP;
  } catch (error) {
    throw new Error(`Could not get BSC gas price: ${error.reason || error.message}`);
  }
}
async function _getXGP() {
  if (Date.now() - XGPBuffer.date < TIME_PRICE) return XGPBuffer.GP;
  try {
    const XGP = await _providerX.getGasPrice();
    XGPBuffer = { date: Date.now(), GP: XGP };
    console.log(`XGP ${XGP}`)
    return XGP;
  } catch (error) {
    throw new Error(`Could not get MATIC gas price: ${error.reason || error.message}`);
  }
}
// Estimate Cost
async function estimateCost(direction: DirectionType) {
  if (Date.now() - Number(costBuffers[direction].date) < TIME_PRICE) return costBuffers[direction].cost;
  const _GPs = {
    BE: [BigNumber.from(54000), BigNumber.from(58000)],
    BX: [BigNumber.from(54000), BigNumber.from(72000)],
    EB: [BigNumber.from(54000), BigNumber.from(58000)],
    EX: [BigNumber.from(54000), BigNumber.from(72000)],
    XB: [BigNumber.from(26000), BigNumber.from(58000)],
    XE: [BigNumber.from(26000), BigNumber.from(58000)],
  }; // [collect() gas, dispense() gas]
  try {
    const _getGP = {
      BE: [_getBGP, _getEGP],
      BX: [_getBGP, _getXGP],
      EB: [_getEGP, _getBGP],
      EX: [_getEGP, _getXGP],
      XB: [_getXGP, _getBGP],
      XE: [_getXGP, _getEGP],
    };
    const [CGP, DGP, { TBP, TEP, TXP }] = await Promise.all([_getGP[direction][0](), _getGP[direction][1](), getPrices()]);
    const _TP = {
      BE: [TBP, TEP],
      BX: [TBP, TXP],
      EB: [TEP, TBP],
      EX: [TEP, TXP],
      XB: [TXP, TBP],
      XE: [TXP, TEP],
    };
    const _DEC = {
      BE: [18, 18],
      BX: [18, 18],
      EB: [18, 18],
      EX: [18, 18],
      XB: [18, 18],
      XE: [18, 18],
    };
    const cost = calcCost(_GPs[direction][0], CGP, _TP[direction][0], _DEC[direction][0], _GPs[direction][1], DGP, _TP[direction][1], _DEC[direction][0]);
    costBuffers[direction] = { date: Date.now(), cost };
    console.log(`Direction ${direction} GPs ${_GPs[direction]}, CGP ${CGP}, TP ${_TP[direction]}, DEC ${_DEC[direction]}, cost ${cost}`)
    return cost;
  } catch (error) {
    throw new Error(`Could not estimate cost: ${error.reason || error.message}`);
  }
}
// Log out the block number
async function logBlock(direction: DirectionType, slot: 0 | 1) {
  const provider = [
    {
      BE: _providerB,
      BX: _providerB,
      EB: _providerE,
      EX: _providerE,
      XB: _providerX,
      XE: _providerX,
    },
    {
      BE: _providerE,
      BX: _providerX,
      EB: _providerB,
      EX: _providerX,
      XB: _providerB,
      XE: _providerE,
    },
  ][slot][direction];
  try {
    const bn = await provider.getBlockNumber();
    logger.debug(`Current block number (cid ${provider.network.chainId}) ${bn}`);
  } catch (error) {
    logger.debug(`!!! Could not log the block number (cid ${provider.network.chainId})`);
  }
}
// Estimate Fees applied
async function estimateFee(direction: DirectionType) {
  try {
    const [cost, params] = await Promise.all([estimateCost(direction), loadChangeableParams()]);
    return cost.mul(params.CTF).div(100);
  } catch (error) {
    throw new Error(`Could not estimate fee: ${error.message}`);
  }
}
// Check safety of following swap attempt
async function assureAmount(direction: DirectionType, address: string) {
  const _TKN = {
    BE: TKNB,
    BX: TKNB,
    EB: TKNE,
    EX: TKNE,
    XB: TKNX,
    XE: TKNX,
  }[direction];
  const _address_BA = {
    BE: address_BABE,
    BX: address_BABX,
    EB: address_BAEB,
    EX: address_BAEX,
    XE: address_BAXE,
    XB: address_BAXB,
  }[direction];
  const [allowance, balance]: [BigNumber, BigNumber] = await Promise.all([_TKN.allowance(address, _address_BA), _TKN.balanceOf(address)]);
  return { allowance, balance };
}
async function assureSafety(direction: DirectionType, address: string): Promise<{ allowance: BigNumber; fee: BigNumber }> {
  try {
    const [{ allowance, balance }, fee, params]: [{ allowance: BigNumber; balance: BigNumber | null }, BigNumber, ChangeableParams] = await Promise.all([
      assureAmount(direction, address),
      estimateFee(direction),
      loadChangeableParams(),
    ]);
    const min = fee.mul(params.FTM).div(100);
    logger.debug(`assureSafety(): [direction]:${direction}|[address]:${address}|[allowance]:${allowance}|[balance]:${balance}|[fee]:${fee}`);
    const _DEC = {
      BE: [18, 18],
      BX: [18, 18],
      EB: [18, 18],
      EX: [18, 18],
      XB: [18, 18],
      XE: [18, 18],
    };
    if (allowance.lt(min)) throw new Error(`Amount is too low. Should be not less than ${BNToNumstr(min, _DEC[direction][0], 2)} DAOvc`);
    if (balance && allowance.gt(balance)) throw new Error(`Actual balance (${balance}) is lower than allowance (${allowance})`);
    return { allowance, fee };
  } catch (error) {
    throw new Error(`Assertion failure: ${error.reason || error.message}`);
  }
}
// Process requests
async function _collect(direction: DirectionType, address: string, amount: BigNumber) {
  console.log("_collect entry");
  const _signer = {
    BE: signerB,
    BX: signerB,
    EB: signerE,
    EX: signerE,
    XB: signerX,
    XE: signerX,
  }[direction];
  const _BA = {
    BE: BABE,
    BX: BABX,
    EB: BAEB,
    EX: BAEX,
    XB: BAXB,
    XE: BAXE,
  }[direction];
  const _getGP = {
    BE: _getBGP,
    BX: _getBGP,
    EB: _getEGP,
    EX: _getEGP,
    XB: _getXGP,
    XE: _getXGP,
  }[direction];
  let tx: providers.TransactionResponse;
  let receipt: providers.TransactionReceipt | TransactionReceipt;
  let err: Error;
  let _nonce: number;
  try {
    _nonce = await _signer.getTransactionCount();
    const _latestNonce = {
      BE: latestNonces.B,
      BX: latestNonces.B,
      EB: latestNonces.E,
      EX: latestNonces.E,
      XB: latestNonces.X,
      XE: latestNonces.X,
    }[direction];
    logger.debug(`_collect(${direction[0]}|${address}) (get_nonce) ${_nonce}|${latestNonces}`);
    if (_nonce <= _latestNonce) _nonce = _latestNonce + 1;
    if (direction === "BE" || direction === "BX") latestNonces.B = _nonce;
    if (direction === "EB" || direction === "EX") latestNonces.E = _nonce;
    if (direction === "XB" || direction === "XE") latestNonces.X = _nonce;
  } catch (error) {
    err = new Error(`[reason]:${error.reason}`);
    console.warn(`_collect(${direction[0]}|${address}) (get_nonce) failure...Info: [${err.message}|==|${error.message}]`);
    logBlock(direction, 0);
    return { err, tx: undefined, receipt: undefined };
  }
  try {
    const ptx = await _BA.populateTransaction.collect(address, amount);
    ptx.gasPrice = await _getGP();
    ptx.nonce = _nonce;
    logger.debug(`_collect(${direction[0]}|${address}) ${ptx.nonce} send...`);
    tx = await _signer.sendTransaction(ptx);
  } catch (error) {
    err = new Error(`[reason]:${error.reason}`);
    logger.warn(`_collect(${direction[0]}|${address}) (ptx_send) failure... Info: [${err.message}|==|${error.message}]`);
    logBlock(direction, 0);
    return { err, tx: undefined, receipt: undefined };
  }
  try {
    logger.debug(`_collect(${direction[0]}|${address}) ${[tx.nonce, tx.hash]} wait...`);
    receipt = await tx.wait();
    logger.debug(`_collect(${direction[0]}|${address}) ${receipt.transactionHash}|GAS ${receipt.gasUsed}/${tx.gasLimit}|GP ${BNToNumstr(tx.gasPrice!, 9, 3)}`);
    return { err: undefined, tx, receipt };
  } catch (error) {
    err = new Error(`[reason]:${error.reason}|[tx]:${[tx.nonce, tx.hash]}`);
    logger.warn(`_collect(${direction[0]}|${address}) (tx_wait) failure... Info: [${err.message}|==|${error.message}]`);
    logBlock(direction, 0);
    return { err, tx, receipt: undefined };
  }
}
function _wait(ms = 5000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function _dispense(
  direction: DirectionType,
  address: string,
  amount: BigNumber,
  retriesLeft = 2,
  nonce?: number
): Promise<
  | { err: Error; tx: undefined; receipt: undefined }
  | { err: Error; tx: providers.TransactionResponse; receipt: undefined }
  | { err: undefined; tx: providers.TransactionResponse; receipt: providers.TransactionReceipt | TransactionReceipt }
> {
  const _signer = {
    BE: signerE,
    BX: signerX,
    EB: signerB,
    EX: signerX,
    XB: signerB,
    XE: signerE,
  }[direction];
  const _BA = {
    BE: BAEB,
    BX: BAXB,
    EB: BABE,
    EX: BAXE,
    XB: BABX,
    XE: BAEX,
  }[direction];
  const _getGP = {
    BE: _getEGP,
    BX: _getXGP,
    EB: _getBGP,
    EX: _getXGP,
    XB: _getBGP,
    XE: _getEGP,
  }[direction];
  const _DEC = {
    BE: 18,
    BX: 18,
    EB: 18,
    EX: 18,
    XB: 18,
    XE: 18,
  }[direction];
  let err: Error;
  let tx: providers.TransactionResponse;
  let receipt: providers.TransactionReceipt | TransactionReceipt;
  let _nonce: number;
  try {
    if (nonce !== undefined) _nonce = nonce;
    else {
      _nonce = await _signer.getTransactionCount();
      const _latestNonce = {
        BE: latestNonces.E,
        BX: latestNonces.X,
        EB: latestNonces.B,
        EX: latestNonces.X,
        XB: latestNonces.B,
        XE: latestNonces.E,
      }[direction];
      logger.debug(`_dispense(${direction[1]}|${address}) (get_nonce) ${_nonce}|${latestNonces}`);
      if (_nonce <= _latestNonce) _nonce = _latestNonce + 1;
      if (direction === "EB" || direction === "XB") latestNonces.B = _nonce;
      if (direction === "BE" || direction === "XE") latestNonces.E = _nonce;
      if (direction === "BX" || direction === "EX") latestNonces.X = _nonce;
    }
  } catch (error) {
    err = new Error(`[reason]:${error.reason}`);
    console.warn(`_dispense(${direction[1]}|${address}) (get_nonce) failure... Retries left: ${retriesLeft} | Info: [${err.message}|==|${error.message}]`);
    logBlock(direction, 1);
    if (retriesLeft) {
      await _wait();
      return await _dispense(direction, address, amount, retriesLeft - 1);
    } else return { err, tx: undefined, receipt: undefined };
  }
  try {
    const ptx = await _BA.populateTransaction.dispense(address, amount);
    ptx.gasPrice = await _getGP();
    ptx.nonce = _nonce;
    logger.debug(`_dispense(${direction[1]}|${address}) ${ptx.nonce} send...`);
    tx = await _signer.sendTransaction(ptx);
  } catch (error) {
    err = new Error(`[reason]:${error.reason}`);
    logger.warn(`_dispense(${direction[1]}|${address}) (ptx_send) failure... Retries left: ${retriesLeft} | Info: [${err.message}|==|${error.message}]`);
    logBlock(direction, 1);
    if (retriesLeft) {
      await _wait();
      return await _dispense(direction, address, amount, retriesLeft - 1, _nonce);
    } else return { err, tx: undefined, receipt: undefined };
  }
  try {
    logger.debug(`_dispense(${direction[1]}|${address}) ${[tx.nonce, tx.hash]} wait...`);
    receipt = await tx.wait();
    logger.debug(`_dispense(${direction[1]}|${address}) ${receipt.transactionHash}|GAS ${receipt.gasUsed}/${tx.gasLimit}|GP ${BNToNumstr(tx.gasPrice!, 9, 3)}`);
    return { err: undefined, tx, receipt };
  } catch (error) {
    err = new Error(`[reason]:${error.reason}|[tx]:${[tx.nonce, tx.hash]}`);
    logger.warn(`_dispense(${direction[1]}|${address}) (tx_wait) failure... Retries left: ${retriesLeft} | Info: [${err.message}|==|${error.message}]`);
    logBlock(direction, 1);
    return { err, tx, receipt: undefined };
  }
}
async function processRequest(direction: DirectionType, address: string) {
  let err: Error;
  let txHashCollect: string;
  let txHashDispense: string;
  let sas: { allowance: BigNumber; fee: BigNumber };
  console.log("Process request 1 try")
  try {
    await writeQueue(direction, address);
    sas = await assureSafety(direction, address);
    const resC = await _collect(direction, address, sas.allowance);
    if (resC.err) throw new Error(`Could not collect: ${resC.err.message}`);
    txHashCollect = resC.receipt.transactionHash as string;
  } catch (error) {
    err = new Error(`Could not process request: ${error.message}`);
    return { err, txHashCollect: undefined, txHashDispense: undefined };
  }
  console.log("Process request 2 try")
  try {
    const resD = await _dispense(direction, address, sas.allowance.sub(sas.fee));
    if (resD.err) throw new Error(`Could not dispense: ${resD.err.message}`);
    txHashDispense = resD.receipt.transactionHash as string;
    try {
      await clearQueue(direction, address);
    } catch (error) {
      logger.warn(`clearQueue() failure... Error: ${error.message}`);
    }
    return { err: undefined, txHashCollect, txHashDispense };
  } catch (error) {
    err = new Error(`Could not process request: ${error.message}`);
    return { err, txHashCollect, txHashDispense: undefined };
  }
}

const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.get("/process", async (req: any, res: any) => {
  const direction = typeof req.query.direction === "string" ? (req.query.direction.toUpperCase() as DirectionType) : undefined;
  const address = typeof req.query.address === "string" ? (req.query.address as string).toLowerCase().replace("xdc", "0x") : undefined;
  let dispenseFailure: false | string = false;
  console.log('app 1 try')
  try {
    if (!direction || !["BE", "BX", "EB", "EX", "XB", "XE"].includes(direction)) throw new Error("Invalid query: 'direction'");
    if (!address || !utils.isAddress(address) || address === "0x0000000000000000000000000000000000000000") throw new Error("Invalid query: 'address'");
    await assertQueue(direction, address);
  } catch (error) {
    res.status(400).send(error.message);
    return;
  }
  const _prefix = `[${direction}][${address}]`;
  console.log('app 2 try')
  try {
    logger.info(`${_prefix}: Incoming request`);
    const result = await processRequest(direction, address);
    if (result.err) {
      // if asset was collected but not dispensed
      if (result.txHashCollect && !result.txHashDispense) dispenseFailure = result.txHashCollect;
      throw result.err;
    }
    logger.info(`${_prefix}: Success. Collect: ${result.txHashCollect}, Dispense: ${result.txHashDispense}`);
    res.status(200).send({ txHashCollect: result.txHashCollect, txHashDispense: result.txHashDispense });
  } catch (error) {
    logger.error(`${_prefix}: Failed. Error: ${error.message}`);
    if (dispenseFailure) {
      // if asset was collected but not dispensed
      logger.fatal(`!!DISPENSE FAILED AFTER SUCCESSFUL COLLECT. TX HASH: [${dispenseFailure}]`);
      // only in that case response status is 500
      res
        .status(500)
        .send(
          "WARNING! Asset was collected but due to internal server error it wasn't dispensed to you on another blockchain. " +
          "Administrator shall soon receive automatic message and dispense manually. Or you can contact the support right now. | " +
          `collect() transaction hash: [${dispenseFailure}] | ` +
          `Error returned: ${error.reason || error.message}`
        );
    } else {
      res.status(400).send(error.reason || error.message);
    }
  }
});
app.get("/info", async (req: any, res: any) => {
  console.log('app 3 try')
  try {
    const BE = await estimateFee("BE");
    const BX = await estimateFee("BX");
    const EB = await estimateFee("EB");
    const EX = await estimateFee("EX");
    const XB = await estimateFee("XB");
    const XE = await estimateFee("XE");
    const { FTM, PSD } = await loadChangeableParams();
    res.status(200).send({
      BE: BE.toString(),
      BX: BX.toString(),
      EB: EB.toString(),
      EX: EX.toString(),
      XB: XB.toString(),
      XE: XE.toString(),
      MIN_BE: BE.mul(FTM).div(100).toString(),
      MIN_BX: BX.mul(FTM).div(100).toString(),
      MIN_EB: EB.mul(FTM).div(100).toString(),
      MIN_EX: EX.mul(FTM).div(100).toString(),
      MIN_XB: XB.mul(FTM).div(100).toString(),
      MIN_XE: XE.mul(FTM).div(100).toString(),
      PSD,
    });
  } catch (error) {
    res.status(400).send(error.reason || error.message);
  }
});
app.get("/nonces", async (req: any, res: any) => {
  res.status(200).send(latestNonces);
});
app.get("/hardresetnonces", async (req: any, res: any) => {
  console.log('app 4 try')
  try {
    if (req.query.devkey !== "f93d58tydj94dk03s5394jd1j9847") throw new Error("Wrong devkey");
    latestNonces.B = (await signerB.getTransactionCount()) - 1;
    latestNonces.E = (await signerE.getTransactionCount()) - 1;
    latestNonces.X = (await signerX.getTransactionCount()) - 1;
    res.status(200).send(latestNonces);
  } catch (error) {
    res.status(400).send(error.reason || error.message);
  }
});
console.log('app listen')
const port = process.env.PORT || 3001;
app.listen(port, async () => {
  latestNonces.B = (await signerB.getTransactionCount()) - 1;
  latestNonces.E = (await signerE.getTransactionCount()) - 1;
  latestNonces.X = (await signerX.getTransactionCount()) - 1;
  logger.info(`Express app listening at port ${port}`);
});
