import { Address, log, BigInt } from '@graphprotocol/graph-ts';
import {
  AccountCreated,
  FundingPaymentRealized,
  TokenPositionChanged,
} from '../../../generated/ClearingHouse/ClearingHouse';
import {
  Account,
  FundingPaymentRealizedEntry,
  RageTradePool,
  TokenPositionChangeEntry,
} from '../../../generated/schema';
import { generateAccountId, getAccount } from './account';
import { getOwner } from './owner';
import { getTokenPosition } from './token-position';
import { generateId, getFundingRate, getSumAX128 } from '../../utils';
import { Pool } from '../../../generated/templates/Pool/Pool';
import { getPriceANDTick } from '../vPoolWrapper/utils';
import { ZERO_BI } from '../../utils/constants';

// @entity Account
export function handleAccountCreated(event: AccountCreated): void {
  let accountId = generateAccountId(event.params.accountId);

  let account = Account.load(accountId);

  if (account !== null) {
    // this should ideally not happen
    log.critical(
      'customlogs: account {} already exists in handleAccountCreated',
      [accountId]
    );
  }

  account = new Account(accountId);
  account.timestamp = event.block.timestamp;
  account.owner = getOwner(event.params.ownerAddress).id;

  account.save();
}

// @entity TokenPosition
export function handleTokenPositionChanged(event: TokenPositionChanged): void {
  log.warning('custom_logs: handleTokenPositionChanged triggered {} {} {} {}', [
    event.params.accountId.toHexString(),
    event.params.poolId.toHexString(),
    event.params.tokenAmountOut.toString(),
    event.params.baseAmountOut.toString(),
  ]);

  let account = getAccount(event.params.accountId);

  // update token position
  {
    let tokenPosition = getTokenPosition(account, event.params.poolId);
    let rageTradePool = RageTradePool.load(tokenPosition.rageTradePool);
    let vPoolWrapperAddress = Address.fromString(rageTradePool.vPoolWrapper);

    tokenPosition.netPosition = tokenPosition.netPosition.plus(
      event.params.tokenAmountOut
    );

    let result = getSumAX128(vPoolWrapperAddress);
    if (!result.reverted) {
      tokenPosition.sumAX128CheckPoint = result.value;
    } else {
      log.error('custom_logs: getSumAX128 reverted {}', ['']);
    }

    if (event.params.tokenAmountOut.gt(ZERO_BI)) {
      tokenPosition.buyVTokenAmount = tokenPosition.buyVTokenAmount.plus(
        event.params.tokenAmountOut.toBigDecimal()
      );
      tokenPosition.buyVQuoteAmount = tokenPosition.buyVQuoteAmount.plus(
        event.params.baseAmountOut.toBigDecimal()
      );
    } else {
      tokenPosition.sellVTokenAmount = tokenPosition.sellVTokenAmount.plus(
        event.params.tokenAmountOut.abs().toBigDecimal()
      );
      tokenPosition.sellVQuoteAmount = tokenPosition.sellVQuoteAmount.plus(
        event.params.baseAmountOut.abs().toBigDecimal()
      );
    }

    let buyAvgPrice = tokenPosition.buyVQuoteAmount.div(
      tokenPosition.buyVTokenAmount
    );
    let sellAvgPrice = tokenPosition.sellVQuoteAmount.div(
      tokenPosition.sellVTokenAmount
    );

    if (tokenPosition.buyVTokenAmount.gt(tokenPosition.sellVTokenAmount)) {
      tokenPosition.realizedPnL = tokenPosition.sellVTokenAmount.times(
        sellAvgPrice.minus(buyAvgPrice)
      );
    } else {
      tokenPosition.realizedPnL = tokenPosition.buyVTokenAmount.times(
        sellAvgPrice.minus(buyAvgPrice)
      );
    }

    tokenPosition.save();
  }

  // create token position change entry
  {
    let tokenPositionChangeEntryId = generateId([
      event.params.accountId.toString(),
      event.block.number.toString(),
      event.params.poolId.toHexString(),
      event.logIndex.toString(),
    ]);

    let tokenPositionChangeEntry = new TokenPositionChangeEntry(
      tokenPositionChangeEntryId
    );

    tokenPositionChangeEntry.timestamp = event.block.timestamp;
    tokenPositionChangeEntry.account = account.id;
    tokenPositionChangeEntry.rageTradePool = event.params.poolId.toHexString();
    tokenPositionChangeEntry.tokenAmountOut = event.params.tokenAmountOut;
    tokenPositionChangeEntry.baseAmountOut = event.params.baseAmountOut;
    tokenPositionChangeEntry.save();
  }

  {
    let rageTradePool = RageTradePool.load(event.params.poolId.toHexString());
    let vPoolWrapperAddress = Address.fromString(rageTradePool.vPoolWrapper);
    let vPoolAddress = Address.fromString(rageTradePool.vPool);

    if (!rageTradePool) {
      log.error(
        'custom_logs: rageTradePool does not exist in handleTokenPositionChanged {}',
        [event.params.poolId.toHexString()]
      );
    }

    rageTradePool.price = getPriceANDTick(vPoolAddress).price;

    let sumAX128_result = getSumAX128(vPoolWrapperAddress);

    if (!sumAX128_result.reverted) {
      rageTradePool.sumAX128 = sumAX128_result.value;
    } else {
      log.error('custom_logs: getSumAX128 reverted {}', ['']);
    }

    // Pool is UniswapV3Pool
    let liquidity_result = Pool.bind(vPoolAddress).try_liquidity();

    if (!liquidity_result.reverted) {
      rageTradePool.liquidity = liquidity_result.value;
    } else {
      log.error('custom_logs: try_liquidity reverted {}', ['']);
    }
  }
}

// @entity Margin
// export function handleDepositMargin(event: DepositMargin): void {
//   log.warning('customlogs: handleDepositMargin triggered {} {} {}', [
//     event.params.accountNo.toHexString(),
//     event.params.rTokenAddress.toString(),
//     event.params.amount.toString(),
//   ]);

//   let account = getAccount(event.params.accountNo);
//   let collateral = getCollateral(account, event.params.rTokenAddress);

//   // TODO is this supposed to be last update timestamp?
//   collateral.timestamp = event.block.timestamp;
//   collateral.amount = collateral.amount.plus(event.params.amount);
//   collateral.save();
// }

// @entity Margin
// export function handleWithdrawMargin(event: WithdrawMargin): void {
//   log.warning('customlogs: handleDepositMargin triggered {} {} {}', [
//     event.params.accountNo.toHexString(),
//     event.params.rTokenAddress.toString(),
//     event.params.amount.toString(),
//   ]);

//   let account = getAccount(event.params.accountNo);
//   let collateral = getCollateral(account, event.params.rTokenAddress);

//   // TODO is this supposed to be last update timestamp?
//   collateral.timestamp = event.block.timestamp;
//   collateral.amount = collateral.amount.minus(event.params.amount);
//   collateral.save();
// }

// @entity LiquidityPosition
export function handleFundingPaymentRealized(
  event: FundingPaymentRealized
): void {
  log.warning('custom_logs: handleFundingPayment triggered {} {} {}', [
    event.params.accountId.toHexString(),
    event.params.amount.toString(),
    event.params.poolId.toHexString(),
  ]);

  let account = getAccount(event.params.accountId);

  let tokenPosition = getTokenPosition(account, event.params.poolId);
  let rageTradePool = RageTradePool.load(event.params.poolId.toHexString());

  let fundingRateId = generateId([
    event.params.accountId.toString(),
    event.params.poolId.toHexString(),
    event.block.number.toHexString(),
    event.logIndex.toHexString(),
  ]);

  let fundingRateEntry = new FundingPaymentRealizedEntry(fundingRateId);

  fundingRateEntry.timestamp = event.block.timestamp;
  fundingRateEntry.tokenPosition = tokenPosition.id;
  fundingRateEntry.amount = event.params.amount; // TODO: is this correct?
  fundingRateEntry.fundingRate = getFundingRate(
    Address.fromString(rageTradePool.vToken)
  );
  fundingRateEntry.side = tokenPosition.netPosition.gt(BigInt.fromI32(0))
    ? 'long'
    : 'short';

  tokenPosition.totalRealizedFundingPaymentAmount = tokenPosition.totalRealizedFundingPaymentAmount.plus(
    fundingRateEntry.amount
  );

  tokenPosition.save();
  fundingRateEntry.save();
}

// @entity LiquidateRanges
// export function handleLiquidateRanges(event: LiquidateRanges): void {}

// @entity LiquidateTokenPosition
// export function handleLiquidateTokenPosition(
//   event: LiquidateTokenPosition
// ): void {}

// @entity LiquidityPosition
// history of each liquidity change event
// export function handleLiquidityChange(event: LiquidityChange): void {
//   log.warning('customlogs: handleLiquidityChange triggered {} {} {}', [
//     event.params.accountNo.toHexString(),
//     event.params.liquidityDelta.toString(),
//     event.params.vToken.toString(),
//   ]);

//   {
//     let liquidityPositionId = generateId([
//       event.params.accountNo.toString(),
//       event.params.vToken.toHexString(),
//     ]);

//     let liquidityPosition = LiquidityPosition.load(liquidityPositionId);
//     if (liquidityPosition === null) {
//       liquidityPosition = new LiquidityPosition(liquidityPositionId);
//       liquidityPosition.timestamp = event.block.timestamp;
//       liquidityPosition.account = event.params.accountNo.toString();
//       liquidityPosition.vToken = event.params.vToken;
//     }

//     liquidityPosition.tickLower = event.params.tickLower;
//     liquidityPosition.tickUpper = event.params.tickUpper;
//     liquidityPosition.tokenAmountOut = event.params.tokenAmountOut;
//     liquidityPosition.liquidityDelta = event.params.liquidityDelta;
//     // TODO: how to handle enum?
//     liquidityPosition.limitOrderType = getLimitOrderEnum(
//       event.params.limitOrderType
//     );

//     // TODO: calculations
//     liquidityPosition.fundingPayment = BigInt.fromI32(0);
//     liquidityPosition.feePayment = BigInt.fromI32(0);
//     liquidityPosition.keeperAddress = Bytes.fromUTF8('0') as Bytes;
//     liquidityPosition.liquidationFee = BigDecimal.fromString('0');
//     liquidityPosition.keeperFee = BigInt.fromI32(0);
//     liquidityPosition.insuranceFundFee = BigInt.fromI32(0);
//     liquidityPosition.save();
//   }
//   /* ------------------ HISTORICAL DATA ENTRIES --------------------------- */

//   {
//     let liquidityChangeEntryId = generateId([
//       event.params.accountNo.toString(),
//       event.block.number.toString(),
//       event.params.vToken.toHexString(),
//       event.logIndex.toString(),
//     ]);

//     let liquidityPositionEntry = new LiquidityPositionEntry(
//       liquidityChangeEntryId
//     );

//     liquidityPositionEntry.timestamp = event.block.timestamp;
//     liquidityPositionEntry.account = event.params.accountNo.toString();
//     liquidityPositionEntry.vToken = event.params.vToken;
//     liquidityPositionEntry.tickLower = event.params.tickLower;
//     liquidityPositionEntry.tickUpper = event.params.tickUpper;
//     liquidityPositionEntry.tokenAmountOut = event.params.tokenAmountOut;
//     liquidityPositionEntry.liquidityDelta = event.params.liquidityDelta;
//     // TODO: how to handle enum?
//     liquidityPositionEntry.limitOrderType = getLimitOrderEnum(
//       event.params.limitOrderType
//     );

//     // event.params.baseAmountOut
//     //TODO: calculations
//     liquidityPositionEntry.fundingPayment = BigInt.fromI32(0);
//     liquidityPositionEntry.feePayment = BigInt.fromI32(0);
//     liquidityPositionEntry.liquidationFee = BigDecimal.fromString('0');
//     liquidityPositionEntry.keeperFee = BigInt.fromI32(0);
//     liquidityPositionEntry.insuranceFundFee = BigInt.fromI32(0);
//     liquidityPositionEntry.save();
//   }
// }

// @entity LiquidityPosition
// export function handleLiquidityFee(event: LiquidityFee): void {}

// @entity LiquidityPosition
// export function handleLiquidityTokenPositionChanged(
//   event: LiquidityTokenPositionChange
// ): void {}

// @entity Protocol
// export function handleProtocolFeeWithdrawm(event: ProtocolFeeWithdrawm): void {}
