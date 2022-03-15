# coudflare-dynamic-dns
A small script to automatically update the IP address(es) attached to a CloudFlare DNS record(s).

This was written in somewhat of a hurry to allow a Raspberry PI to host some university projects.

## Configuration

The `config.json` file's `records` array can handle individual DNS records in this format:

```json
{
    "ip": "",
    "checkIntervalMS": 900000,
    "records": [
        {
            "authEmail": "example1@example.com",
            "authKey": "0000000000000000000000000000000000000",
            "zoneName": "example1.com",
            "zoneIdentifier": "",
            "recordName": "example1.com",
            "recordIdentifier": ""
        },
        {
            "authEmail": "example2@example.com",
            "authKey": "0000000000000000000000000000000000000",
            "zoneName": "example2.com",
            "zoneIdentifier": "",
            "recordName": "example2.com",
            "recordIdentifier": ""
        }
    ]
}
```

The `authEmail` field is the email that is registered with the domain, and `authKey` can be obtained from [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens), in the "Global API Key" section.

The `zoneName` should be set to the root domain name of the website, while the `recordName` is the name of the A Type record.

Both `zoneIdentifier` and `recordIdentifier` should be left empty, along with the `ip` field on the top of the file; these will be filled out by the script on startup.

The config file's `checkIntervalMS` key can be used to set how often the script should check if the IP address has changed. By default it is set to 15 minutes.

Once started, this script runs indefinitely, and logs any issues into `./logs/log.txt`.

## IP check

The script checks for the machine's IP address by sending a get request to a great external service, [https://www.ipify.org/](https://www.ipify.org/) <3.