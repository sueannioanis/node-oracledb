/* Copyright (c) 2015, 2024, Oracle and/or its affiliates. */

/******************************************************************************
 *
 * This software is dual-licensed to you under the Universal Permissive License
 * (UPL) 1.0 as shown at https://oss.oracle.com/licenses/upl and Apache License
 * 2.0 as shown at http://www.apache.org/licenses/LICENSE-2.0. You may choose
 * either license.
 *
 * If you elect to accept the software under the Apache License, Version 2.0,
 * the following applies:
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * NAME
 *   blobhttp.js
 *
 * DESCRIPTION
 *   Listens for an HTTP request and returns an image queried from a BLOB column
 *   Also shows the connection pool's caching using a 'default' pool.
 *
 *   Start the listener with 'node blobhttp.js' and then use a browser
 *   to load http://localhost:7000/getimage
 *
 *****************************************************************************/

'use strict';

Error.stackTraceLimit = 50;

const url = require('url');
const http = require('http');
const oracledb = require('oracledb');
const dbConfig = require('./dbconfig.js');
const demoSetup = require('./demosetup.js');

// This example runs in both node-oracledb Thin and Thick modes.
//
// Optionally run in node-oracledb Thick mode
if (process.env.NODE_ORACLEDB_DRIVER_MODE === 'thick') {

  // Thick mode requires Oracle Client or Oracle Instant Client libraries.
  // On Windows and macOS you can specify the directory containing the
  // libraries at runtime or before Node.js starts.  On other platforms (where
  // Oracle libraries are available) the system library search path must always
  // include the Oracle library path before Node.js starts.  If the search path
  // is not correct, you will get a DPI-1047 error.  See the node-oracledb
  // installation documentation.
  let clientOpts = {};
  // On Windows and macOS platforms, set the environment variable
  // NODE_ORACLEDB_CLIENT_LIB_DIR to the Oracle Client library path
  if (process.platform === 'win32' || process.platform === 'darwin') {
    clientOpts = { libDir: process.env.NODE_ORACLEDB_CLIENT_LIB_DIR };
  }
  oracledb.initOracleClient(clientOpts);  // enable node-oracledb Thick mode
}

console.log(oracledb.thin ? 'Running in thin mode' : 'Running in thick mode');

const httpPort = 7000;

// Main entry point.  Creates a connection pool which becomes the
// 'default' pool, and then creates an HTTP server.
async function init() {
  try {
    await oracledb.createPool(dbConfig);
    console.log('Connection pool started');

    // create the demo table
    const connection = await oracledb.getConnection();
    await demoSetup.setupLobs(connection, true);
    await connection.close();

    // Create HTTP server and listen on port httpPort
    const server = http.createServer();
    server.on('error', (err) => {
      throw err;
    });
    server.on('request', (request, response) => {
      handleRequest(request, response);
    });
    await server.listen(httpPort);
    console.log("Server is running.  Try loading http://localhost:" + httpPort + "/getimage");

  } catch (err) {
    console.error('init() error: ' + err.message);
  }
}

// Handles each web request
async function handleRequest(request, response) {

  const requrl = url.parse(request.url, true);
  const action = requrl.pathname;

  if (action == '/getimage') {

    let connection;

    try {
      connection = await oracledb.getConnection();  // gets a connection from the 'default' connection pool

      const result = await connection.execute(
        "SELECT b FROM no_lobs WHERE id = :id",  // get the image
        { id: 2 }
      );
      if (result.rows.length === 0) {
        throw new Error("No data selected from table.");
      }

      const lob = result.rows[0][0];
      if (lob === null) {
        throw new Error("BLOB was NULL");
      }

      const doStream = new Promise((resolve, reject) => {
        lob.on('end', () => {
          // console.log("lob.on 'end' event");
          response.end();
        });
        lob.on('close', () => {
          // console.log("lob.on 'close' event");
          resolve();
        });
        lob.on('error', (err) => {
          // console.log("lob.on 'error' event");
          reject(err);
        });
        response.writeHead(200, {'Content-Type': 'image/jpeg' });
        lob.pipe(response);  // write the image out
      });

      await doStream;

    } catch (err) {
      console.error(err);
      await closePoolAndExit();
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (err) {
          console.error(err);
        }
      }
    }

  } else {
    response.writeHead(200, {'Content-Type': 'text/plain' });
    response.end("Try requesting: http://localhost:" + httpPort + "/getimage\n");
  }
}

async function closePoolAndExit() {
  console.log('\nTerminating');
  try {
    // Get the pool from the pool cache and close it when no
    // connections are in use, or force it closed after 2 seconds.
    // If this hangs, you may need DISABLE_OOB=ON in a sqlnet.ora file.
    // This setting should not be needed if both Oracle Client and Oracle
    // Database are 19c (or later).
    await oracledb.getPool().close(2);
    console.log('Pool closed');
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

process
  .once('SIGTERM', closePoolAndExit)
  .once('SIGINT',  closePoolAndExit);

init();
