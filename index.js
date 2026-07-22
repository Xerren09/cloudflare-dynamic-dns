#!/usr/bin / env node
// @ts-check
const { writeFileSync, existsSync, readFileSync, appendFileSync } = require("node:fs");
const { join } = require("node:path");
const { argv } = require("node:process");

// TODO: IPv6 support (AAAA records + IP query)

const logLevel = argv.includes("--verbose") ? "verbose" : "normal";
const logPath = join(__dirname, 'log.txt');
const ipFilePath = join(__dirname, 'ipv4');

const defaultConfigPath = join(__dirname, 'config.json');
const configPath = argv.includes("--config") ? argv[argv.indexOf("--config") + 1] : defaultConfigPath;
//
if (existsSync(configPath) === false) {
    log("Configuration file not found", configPath);
    throw new Error(`Configuration file at "${configPath}" does not exist.`);
}
/**
 * Used DNS configuration.
 * @type {{
 *  checkIntervalMS: number,
 *  token: string,
 *  records: {"zoneName": string, "recordName": string, "zoneIdentifier": string|undefined, "recordIdentifier": string|undefined, token?:string }[]
 *  }}
 */
var config = JSON.parse(readFileSync(configPath).toString());

// Expects text/plain
const IP_check_server_url = "https://api.ipify.org/"; // They are very cool <3

var updateCheckInterval = null;
var ip = "";

/**
 * Gets the API url for fetching the ZoneID from its name. ({@link https://developers.cloudflare.com/api/resources/zones/methods/list#(resource)%20zones%20%3E%20(method)%20list%20%3E%20(params)%20default%20%3E%20(param)%20name%20%3E%20(schema)|Cloudflare documentation})
 * @param {string} zoneName The record's zone's name, same as the domain.
 * @returns 
 */
const getCloudflareZoneIdURL = (zoneName) => { return `https://api.cloudflare.com/client/v4/zones?name=${zoneName}` }
/**
 * Gets the API url for fetching the RecordID from its name. ({@link https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list#(resource)%20dns.records%20%3E%20(method)%20list%20%3E%20(params)%20default%20%3E%20(param)%20name%20%3E%20(schema)%20%3E%20(property)%20exact|Cloudflare documentation})
 * @param {string} zoneID Fetched from {@link getCloudflareZoneIdURL}.
 * @param {string} recordName The record's name, same as the domain.
 * @returns 
 */
const getCloudflateRecordIdURL = (zoneID, recordName) => { return `https://api.cloudflare.com/client/v4/zones/${zoneID}/dns_records?name=${recordName}` }
/**
 * Gets the API url for fetching the contents of a specific DNS record. ({@link https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/edit|Cloudflare documentation})
 * @param {string} zoneID Fetched from {@link getCloudflareZoneIdURL}.
 * @param {string} recordID Fetched from {@link getCloudflateRecordIdURL}.
 * @returns 
 */
const getCloudflareRecordURL = (zoneID, recordID) => {return `https://api.cloudflare.com/client/v4/zones/${zoneID}/dns_records/${recordID}`}

/**
 * Writes an event to the log file.
 * @param {string} event 
 * @param {string} description 
 */
function log(event, description = "") {
    const logline = `${new Date().toUTCString()} - ${event}${description.length == 0 ? `.` : ` :\n${description}`}\n`;
    console.log(logline);
    appendFileSync(logPath, logline);
}

async function start() {
    if (config.checkIntervalMS != undefined && config.checkIntervalMS > 0)
    {
        updateCheckInterval = setInterval(update, config.checkIntervalMS);
        log(`Script started with native interval of ${config.checkIntervalMS}ms`);
    }
    await resolveIdentifiers();
    update();
}

async function update() {
    const changed = await checkIP();
    if (changed) {
        for (const record of config.records) {
            await updateRecord(record);
        }
    }
}

async function checkIP() {
    const old = existsSync(ipFilePath) ? readFileSync(ipFilePath) : "unknown";
    try {
        const res = await fetch(IP_check_server_url);
        if (!res.ok) {
            throw res;
        }
        const current = await res.text();
        if (old != current) {
            log(`New IP ${current}`, `${old} -> ${current}`);
            ip = current;
            writeFileSync(ipFilePath, current);
            return true;
        }
        else {
            if (logLevel == 'verbose') {
                log('IP not changed');
            }
        }
    }
    catch (error) {
        console.log(error);
        log("IP check failed", await getFetchErrorCause(error));
    }
    return false;
}

/**
 * Resolves Cloudflare Zone and Record IDs if they are not in the config file.
 */
async function resolveIdentifiers() {
    for (const record of config.records) {
        const headers = getAuthHeader(record);
        if (record.zoneIdentifier == undefined || record.zoneIdentifier == "") {
            const cloudflareZoneID_URL = getCloudflareZoneIdURL(record.zoneName);
            try {
                const res = await fetch(cloudflareZoneID_URL, { headers: headers });
                const data = await res.json();
                const zoneID = data.result[0].id;
                record.zoneIdentifier = zoneID;
                log(`Zone ID resolved for ${record.zoneName}`, `${record.zoneName} -> ${zoneID}`);
            }
            catch (error) {
                log(`Failed to resolve Zone ID for ${record.zoneName}`, await getFetchErrorCause(error));
            }
        }
        if (record.recordIdentifier == undefined || record.recordIdentifier == "") {
            if (record.zoneIdentifier === undefined || record.zoneIdentifier == "") {
                log(`Skipping Record ID resolution for ${record.zoneName}`, "Zone ID not previously resolved");
                continue;
            }
            const cloudflareRecordID_URL = getCloudflateRecordIdURL(record.zoneIdentifier, record.recordName);
            try {
                const res = await fetch(cloudflareRecordID_URL, { headers: headers });
                const data = await res.json();
                let recordID = data.result[0].id;
                record.recordIdentifier = recordID;
                log(`Record ID resolved for ${record.recordName}`, `${record.recordName} -> ${recordID}`);
            }
            catch (error) {
                log(`Failed to resolve Record ID for ${record.recordName}`, await getFetchErrorCause(error));
            }
        }
    }
    // Write out the identifiers back to the config file
    writeFileSync(configPath, JSON.stringify(config, null, "\t"));
}

/**
 * Updates the given DNS A record with the current IP.
 * @param {{token?:string, zoneName: string, zoneIdentifier?:string, recordName:string, recordIdentifier?:string, type?:"A"|"AAAA" }} record 
 */
async function updateRecord(record) {
    // @ts-expect-error By this point resolveIdentifiers has run so the identifiers are safe to use
    const cloudflareUpdateDNS_URL = getCloudflareRecordURL(record.zoneIdentifier, record.recordIdentifier);
    const body = {
        type: "A",
        name: record.recordName, 
        content: ip
    }
    const headers = getAuthHeader(record);
    try {
        // https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/edit
        const res = await fetch(cloudflareUpdateDNS_URL, {
            method: 'PATCH',
            body: JSON.stringify(body),
            headers: headers 
        });
        if (!res.ok) {
            throw res;
        }
        log(`DNS Record updated for ${record.recordName}.`, `New IP: ${ip}.`);
    }
    catch (error) {
        console.log(error instanceof Error);
        log(`DNS Record update failed for ${record.recordName}`, await getFetchErrorCause(error));
    }
}

/**
 * Retruns the auth header to the given record. Uses either the record's own token, or the global one.
 * @param {{token?:string}} record 
 * @returns 
 */
function getAuthHeader(record) {
    const token = record.token ?? config.token;
    return {
        'Content-Type': 'application/json',
        'Authorization' : `Bearer ${token}`
    }
}

/**
 * Gets the body of a fetch response.
 * @param {Response} response 
 * @returns {Promise<string|undefined>} `string` is possible. Otherwise if both {@link Response.json()} and {@link Response.text()} fails, `undefined`.
 */
async function getFetchBody(response) {
    let ret = undefined;
    try {
        ret = JSON.stringify(await response.json(), null, 2);
    }
    catch {
        try {
            ret = await response.text();
        }
        catch {
            // It's an Error typed Response
            // https://developer.mozilla.org/en-US/docs/Web/API/Response/error_static
        }
    }
    return ret;
}

/**
 * Gets the cause of the network request as a string.
 * @param {any} error Expected to be {@link Error} or {@link Response}.
 * @returns {Promise<string|undefined>}
 */
async function getFetchErrorCause(error) {
    if (error instanceof Error) {
        // This is a JS error
        return `${error.message}${error.cause ? ` - ${error.cause}` : ""}`
    }
    else {
        // This is an API error
        if (error instanceof Response) {
            const cause = await getFetchBody(error);
            return cause;
        }
    }
    return undefined;
}

start();
