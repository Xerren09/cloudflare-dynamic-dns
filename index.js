#!/usr/bin/env node
const axios = require('axios').default;
const fs = require('fs');
const path = require('path');
const argv = require('process').argv;

const logLevel = argv.includes("--verbose") ? "verbose" : "normal";
const logPath = path.join(__dirname, 'log.txt');
const ipFilePath = path.join(__dirname, 'ipv4');

const defaultConfigPath = path.join(__dirname, 'config.json');
const configPath = argv.includes("--config") ? argv[argv.indexOf("--config")+1] : defaultConfigPath;
var config = JSON.parse(fs.readFileSync(configPath));

// Expects text/plain
const IP_check_server_url = "https://api.ipify.org/"; // They are very cool <3

const getCloudflareZoneIdURL = (zoneName) => {return `https://api.cloudflare.com/client/v4/zones?name=${zoneName}`}
const getCloudflateRecordIdURL = (zoneID, recordName) => {return `https://api.cloudflare.com/client/v4/zones/${zoneID}/dns_records?name=${recordName}`}
const getCloudflareRecordURL = (zoneID, recordID) => {return `https://api.cloudflare.com/client/v4/zones/${zoneID}/dns_records/${recordID}`}

var updateCheckInterval = null;
var ip = "";

function log(event, description = "") {
    const logline = `${new Date().toUTCString()} - ${event}${description.length == 0 ? `.` : ` :\n${description}`}\n`;
    console.log(logline);
    if (!fs.existsSync(logPath))
    {
        fs.writeFileSync(logPath, logline);
    }
    else {
        fs.appendFileSync(logPath, logline);
    }
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
        for (record of config.records) {
            await updateRecord(record);
        }
    }
}

async function checkIP() {
    const old = fs.existsSync(ipFilePath) ? fs.readFileSync(ipFilePath) : "unknown";
    try {
        const res = await axios.get(IP_check_server_url);
        const current = res.data;
        if (old != current) {
            log(`New IP ${current}`, `${old} -> ${current}`);
            ip = current;
            fs.writeFileSync(ipFilePath, current);
            return true;
        }
        else {
            if (logLevel == 'verbose') {
                log('IP not changed');
            }
        }
    }
    catch (error) {
        if (error.response) {
            log("IP check failed", `${error.response.status} - ${error.response.data}`);
        }
        else if (error.request) {
            log("IP check failed", `Request failed.`);
        }
        else {
            log("IP check failed", error.message);
        }
    }
    return false;
}

/**
 * Resolves Cloudflare Zone and Record IDs if they are not in the config file.
 */
async function resolveIdentifiers() {
    for (record of config.records) {
        let zoneID = record.zoneIdentifier;
        const headers = getAuthHeader(record);
        if (record.zoneIdentifier == "" || record.zoneIdentifier == undefined)
        {
            const cloudflareZoneID_URL = getCloudflareZoneIdURL(record.zoneName);
            try {
                const res = await axios.get(cloudflareZoneID_URL, { headers: headers });
                zoneID = res.data.result[0].id;
                record.zoneIdentifier = zoneID;
                log(`Zone ID resolved for ${record.zoneName}`, `${record.zoneName} -> ${zoneID}`);
            }
            catch (error) {
                if (error.response) {
                    log(`Failed to resolve Zone ID for ${record.zoneName}`, `${error.response.status} - ${JSON.stringify(error.response.data, null, "\t")}`);
                }
                else if (error.request) {
                    log(`Failed to resolve Zone ID for ${record.zoneName}`, `No response received.`);
                }
                else {
                    log(`Failed to resolve Zone ID for ${record.zoneName}`, error.message);
                }
            }
        }
        if (record.recordIdentifier == "" || record.recordIdentifier == undefined) {
            const cloudflareRecordID_URL = getCloudflateRecordIdURL(zoneID, record.recordName);
            try {
                const res = await axios.get(cloudflareRecordID_URL, { headers: headers });
                let recordID = res.data.result[0].id;
                record.recordIdentifier = recordID;
                log(`Record ID resolved for ${record.recordName}`, `${record.recordName} -> ${recordID}`);
            }
            catch (error) {
                if (error.response) {
                    log(`Failed to resolve Record ID for ${record.recordName}`, `${error.response.status} - ${JSON.stringify(error.response.data, null, "\t")}`);
                }
                else if (error.request) {
                    log(`Failed to resolve Record ID for ${record.recordName}`, `No response received.`);
                }
                else {
                    log(`Failed to resolve Record ID for ${record.recordName}`, error.message);
                }
            }
        }
    }
    // Write out the identifiers back to the config file
    fs.writeFileSync(configPath, JSON.stringify(config, null, "\t"));
}

/**
 * Updates the given DNS A record with the current IP.
 * @param {{token?:string, zoneName?: string, zoneIdentifier:string, recordName:string, recordIdentifier:string, type:"A"|"AAAA" }} record 
 */
async function updateRecord(record) {
    const cloudflareUpdateDNS_URL = getCloudflareRecordURL(record.zoneIdentifier, record.recordIdentifier);
    const body = {
        id: record.zoneIdentifier,
        type: "A",
        name: record.recordName, 
        content: ip
    }
    const headers = getAuthHeader(record);
    try {
        await axios.patch(cloudflareUpdateDNS_URL, body, { headers: headers });
        log(`DNS Record updated for ${record.recordName}.`, `New IP: ${ip}.`);
    }
    catch (error) {
        if (error.response) {
            log(`DNS Record update failed for ${record.recordName}`, `${error.response.status} - ${JSON.stringify(error.response.data, null, "\t")}`);
        }
        else if (error.request) {
            log(`DNS Record update failed for ${record.recordName}`, `No response received.`);
        }
        else {
            log(`DNS Record update failed for ${record.recordName}`, error.message);
        }
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

start();
