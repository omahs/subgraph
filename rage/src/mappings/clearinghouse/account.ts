import { Account } from '../../../generated/schema';
import { Address, BigInt, log } from '@graphprotocol/graph-ts';

import { getOwner } from './owner';
import { ZERO_BD } from '../../utils/constants';

export function generateAccountId(accountNo: BigInt): string {
  return accountNo.toString();
}

/**
 * Gives the account object, creates one if it doesn't exist on the graph
 * @param accountNo Accoount number
 * @returns Account object
 */
export function getAccount(accountNo: BigInt): Account {
  let accountId = generateAccountId(accountNo);

  let account = Account.load(accountId);
  if (account === null) {
    // this should ideally not happen
    log.critical('custom_logs: account {} did not exist in getAccount', [
      accountId,
    ]);
    // creating empty account for other code to work
    account = new Account(accountId);
    account.marginBalance = ZERO_BD;
    account.vQuoteBalance = ZERO_BD;

    account.timestamp = BigInt.fromI32(0);
    account.owner = getOwner(Address.fromI32(0) as Address).id;
    account.save();
  }

  return account as Account;
}
