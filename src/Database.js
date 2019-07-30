// Copyright (C) 2018-2019, Zpalmtree
//
// Please see the included LICENSE file for more information.

import SQLite from 'react-native-sqlite-storage';

import { AsyncStorage } from 'react-native';

import Config from './Config';
import Constants from './Constants';

import { Globals } from './Globals';

import { reportCaughtException } from './Sentry';

/* Use promise based API instead of callback based */
SQLite.enablePromise(true);

let database;

export async function deleteDB() {
    try {
        await setHaveWallet(false);

        await SQLite.deleteDatabase({
            name: 'data.DB',
            location: 'default',
        });
    } catch (err) {
        Globals.logger.addLogMessage(err);
    }
}

async function saveWallet(wallet) {
    await database.transaction((tx) => {
        tx.executeSql(
            `UPDATE
                wallet
            SET
                json = ?
            WHERE
                id = 0`,
            [wallet]
        );
    });
}

export async function loadWallet() {
    try {
        const [data] = await database.executeSql(
            `SELECT
                json
            FROM
                wallet
            WHERE
                id = 0`,
        );

        if (data && data.rows && data.rows.length >= 1) {
            return [ data.rows.item(0).json, undefined ];
        }
    } catch (err) {
        reportCaughtException(err);
        return [ undefined, err ];
    }

    return [ undefined, 'Wallet not found in database!' ];
}

/* Create the tables if we haven't made them already */
async function createTables(DB) {
    const [dbVersionData] = await DB.executeSql(
        `PRAGMA user_version`,
    );

    let dbVersion = 0;

    if (dbVersionData && dbVersionData.rows && dbVersionData.rows.length >= 1) {
        dbVersion = dbVersionData.rows.item(0).user_version;
    }

    await DB.transaction((tx) => {
        
        /* We get JSON out from our wallet backend, and load JSON in from our
           wallet backend - it's a little ugly, but it's faster to just read/write
           json to the DB rather than structuring it. */
        tx.executeSql(
            `CREATE TABLE IF NOT EXISTS wallet (
                id INTEGER PRIMARY KEY,
                json TEXT
            )`
        );

        tx.executeSql(
            `CREATE TABLE IF NOT EXISTS preferences (
                id INTEGER PRIMARY KEY,
                currency TEXT,
                notificationsenabled BOOLEAN,
                scancoinbasetransactions BOOLEAN,
                limitdata BOOLEAN,
                theme TEXT,
                pinconfirmation BOOLEAN
            )`
        );

        /* Add new autooptimize column */
        if (dbVersion === 0) {
            tx.executeSql(
                `ALTER TABLE
                    preferences
                ADD
                    autooptimize BOOLEAN`
            );
        }

        tx.executeSql(
            `CREATE TABLE IF NOT EXISTS payees (
                nickname TEXT,
                address TEXT,
                paymentid TEXT
            )`
        );

        tx.executeSql(
            `CREATE TABLE IF NOT EXISTS transactiondetails (
                hash TEXT,
                memo TEXT,
                address TEXT,
                payee TEXT
            )`
        );

        /* Enter initial wallet value that we're going to overwrite later via
           primary key, provided it doesn't already exist */
        tx.executeSql(
            `INSERT OR IGNORE INTO wallet
                (id, json)
            VALUES
                (0, '')`
        );

        /* Setup default preference values */
        tx.executeSql(
            `INSERT OR IGNORE INTO preferences
                (id, currency, notificationsenabled, scancoinbasetransactions, limitdata, theme, pinconfirmation, autooptimize)
            VALUES
                (0, 'usd', 1, 0, 0, 'darkMode', 0, 1)`
        );

        /* Set new auto optimize column if not assigned yet */
        if (dbVersion === 0) {
            tx.executeSql(
                `UPDATE
                    preferences
                SET
                    autooptimize = 1
                WHERE
                    id = 0`
            );
        }

        tx.executeSql(
            `PRAGMA user_version = 1`
        );
    });
}

export async function openDB() {
    try {
        database = await SQLite.openDatabase({
            name: 'data.DB',
            location: 'default',
        });

        await createTables(database);
    } catch (err) {
        Globals.logger.addLogMessage('Failed to open DB: ' + err);
    }
}

export async function savePreferencesToDatabase(preferences) {
    await database.transaction((tx) => {
        tx.executeSql(
            `UPDATE
                preferences
            SET
                currency = ?,
                notificationsenabled = ?,
                scancoinbasetransactions = ?,
                limitdata = ?,
                theme = ?,
                pinconfirmation = ?,
                autooptimize = ?
            WHERE
                id = 0`,
            [
                preferences.currency,
                preferences.notificationsEnabled ? 1 : 0,
                preferences.scanCoinbaseTransactions ? 1 : 0,
                preferences.limitData ? 1 : 0,
                preferences.theme,
                preferences.authConfirmation ? 1 : 0,
                preferences.autoOptimize ? 1 : 0,
            ]
        );
    });
}

export async function loadPreferencesFromDatabase() {
    const [data] = await database.executeSql(
        `SELECT
            currency,
            notificationsenabled,
            scancoinbasetransactions,
            limitdata,
            theme,
            pinconfirmation,
            autooptimize
        FROM
            preferences
        WHERE
            id = 0`,
    );

    if (data && data.rows && data.rows.length >= 1) {
        const item = data.rows.item(0);

        return {
            currency: item.currency,
            notificationsEnabled: item.notificationsenabled === 1,
            scanCoinbaseTransactions: item.scancoinbasetransactions === 1,
            limitData: item.limitdata === 1,
            theme: item.theme,
            authConfirmation: item.pinconfirmation === 1,
            autoOptimize: item.autooptimize === 1,
        }
    }

    return undefined;
}

export async function savePayeeToDatabase(payee) {
    await database.transaction((tx) => {
        tx.executeSql(
            `INSERT INTO payees
                (nickname, address, paymentid)
            VALUES
                (?, ?, ?)`,
            [
                payee.nickname,
                payee.address,
                payee.paymentID,
            ]
        );
    });
}

export async function removePayeeFromDatabase(nickname) {
    await database.transaction((tx) => {
        tx.executeSql(
            `DELETE FROM
                payees
            WHERE
                nickname = ?`,
            [ nickname ]
        );
    });
}

export async function loadPayeeDataFromDatabase() {
    const [data] = await database.executeSql(
        `SELECT
            nickname,
            address,
            paymentid
        FROM
            payees`
    );

    if (data && data.rows && data.rows.length) {
        const res = [];

        for (let i = 0; i < data.rows.length; i++) {
            const item = data.rows.item(i);
            res.push({
                nickname: item.nickname,
                address: item.address,
                paymentID: item.paymentid,
            });
        }

        return res;
    }

    return undefined;
}

export async function saveToDatabase(wallet) {
    try {
        await saveWallet(wallet.toJSONString());
        await setHaveWallet(true);
    } catch (err) {
        reportCaughtException(err);
        Globals.logger.addLogMessage('Err saving wallet: ' + err);
    };
}

export async function haveWallet() {
    try {
        const value = await AsyncStorage.getItem(Config.coinName + 'HaveWallet');
        
        if (value !== null) {
            return value === 'true';
        }

        return false;
    } catch (error) {
        reportCaughtException(error);
        Globals.logger.addLogMessage('Error determining if we have data: ' + error);
        return false;
    }
}

export async function setHaveWallet(haveWallet) {
    try {
        await AsyncStorage.setItem(Config.coinName + 'HaveWallet', haveWallet.toString());
    } catch (error) {
        reportCaughtException(error);
        Globals.logger.addLogMessage('Failed to save have wallet status: ' + error);
    }
}

export async function saveTransactionDetailsToDatabase(txDetails) {
    await database.transaction((tx) => {
        tx.executeSql(
            `INSERT INTO transactiondetails
                (hash, memo, address, payee)
            VALUES
                (?, ?, ?, ?)`,
            [
                txDetails.hash,
                txDetails.memo,
                txDetails.address,
                txDetails.payee
            ]
        );
    });
}

export async function loadTransactionDetailsFromDatabase() {
    const [data] = await database.executeSql(
        `SELECT
            hash,
            memo,
            address,
            payee
        FROM
            transactiondetails`
    );

    if (data && data.rows && data.rows.length) {
        const res = [];

        for (let i = 0; i < data.rows.length; i++) {
            const item = data.rows.item(i);
            res.push({
                hash: item.hash,
                memo: item.memo,
                address: item.address,
                payee: item.payee,
            });
        }

        return res;
    }

    return undefined;
}
