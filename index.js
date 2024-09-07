#!/usr/bin/env node
const axios = require('axios').default;
const fs = require('fs');

const configPath = './config.json';
const logPath = './logs/log.txt';

var config = JSON.parse(fs.readFileSync(configPath));

const API_check_server = "https://api.ipify.org/?format=json"; // They are very cool <3
const create_cloudflare_getZoneID_URL = (zoneName) => {return `https://api.cloudflare.com/client/v4/zones?name=${zoneName}`}
const create_cloudflare_getRecordID_URL = (zoneID, recordName) => {return `https://api.cloudflare.com/client/v4/zones/${zoneID}/dns_records?name=${recordName}`}
const create_cloudflare_updateDNSrecord_URL = (zoneID, recordID) => {return `https://api.cloudflare.com/client/v4/zones/${zoneID}/dns_records/${recordID}`}

var updateCheckInterval = null;

function log (message, description="") {
	const logline = `${new Date().toUTCString()} - ${description}:\n${message}\n`;
	fs.appendFileSync(logPath, logline);
}

async function start() {
	if (!fs.existsSync(logPath))
	{
		fs.writeFileSync(logPath, "");
		log("Log file created", "Initialisation");
	}
    if (config.checkIntervalMS > 0)
    {
        updateCheckInterval = setInterval(checkIP, config.checkIntervalMS);
        log(`Script started with native interval of ${config.checkIntervalMS}ms`, "Startup");
    }
    // Wait until all the IDs are received.
    await getIDs();
    checkIP();
}

function checkIP () {
	axios.get(API_check_server).then(res => {
		if (config.ip != res.data.ip)
		{
			// IP changed, update DNS records
			config.ip = res.data.ip;
			log(`New IP: ${config.ip}`, "IP updated");
			updateConfig();
		}
		else if (config.logging == 'full') {
			log('IP not changed');
		}
	}).catch(error => {
		log(error, "IP check failed");
	})
}

async function getIDs () {
	for (const [index, record] of config.records.entries())
	{
		let zoneID = "";
		let recordID = "";
		if (record.recordIdentifier == "" || record.zoneIdentifier == "")
		{
			const cloudflare_headers = {
				'Content-Type': 'application/json',
				'X-Auth-Email': record.authEmail,
				'X-Auth-Key': record.authKey
			}
			// Get the request url for the Zone ID
			const cloudflareZoneID_URL = create_cloudflare_getZoneID_URL(record.zoneName);
			await axios.get(cloudflareZoneID_URL, {headers: cloudflare_headers}).then(res => {
				zoneID = res.data.result[0].id;
				config.records[index].zoneIdentifier = zoneID;
			}).catch(error => {
				log(error, "Zone ID request failed");
			});
			// Get the request url for the Record ID
			const cloudflareRecordID_URL = create_cloudflare_getRecordID_URL(zoneID, record.recordName);
			await axios.get(cloudflareRecordID_URL, {headers: cloudflare_headers}).then(res => {
				recordID = res.data.result[0].id;
				config.records[index].recordIdentifier = recordID;
			}).catch(error => {
				log(error, "Record ID request failed");
			});
		}
	};
}

function updateConfig() {
	fs.writeFileSync(configPath, JSON.stringify(config, null, "\t"));
	updateDNS();
}

function updateDNS() {
	config.records.forEach(record => {
		const cloudflareUpdateDNS_URL = create_cloudflare_updateDNSrecord_URL(record.zoneIdentifier, record.recordIdentifier);
		const cloudflareUpdate = {
			id: record.zoneIdentifier,
			type: "A",
			name: record.recordName, 
			content: config.ip
		}
		const cloudflare_headers = {
			'Content-Type': 'application/json',
			'X-Auth-Email': record.authEmail,
			'X-Auth-Key': record.authKey
		}
		axios.patch(cloudflareUpdateDNS_URL, cloudflareUpdate, {headers: cloudflare_headers}).then(res => {
			log(`DNS Record updated for ${record.recordName}.`, `New IP: ${config.ip}.`);
		}).catch(error => {
			log(error, `DNS Record update failed for ${record.recordName}`);
		});
	});
}

start();
