# cloudflare-dynamic-dns
A small NodeJS tool to automatically update the IP address of CloudFlare DNS records.

## Requirements

* Node v14+
* Write access in the tool's own folder.

## Usage

The tool can be either be run on a schedule (for example via cron) or on a NodeJS interval (See [`checkIntervalMS`](#checkIntervalMS)) once started.

Cron example (check once every 2 hours) : `0 */2 * * * cd /opt/DNS && node index.js`.

### CLI arguments

`--config <file-path>` : Use a different configuration file than the default (`.\config.json`). When used, ensure that the script has write access to the file.

`--verbose` : Logs every IP check, regardless if the address changed.

### Configuration

> [!WARNING]
> Configuration files contain secrets and should be treated as confidential.

To configure which records to update, fill out the `config.json` file:

```json
{
    "checkIntervalMS": 0,
    "token": "0000000000000000000000000000000000000",
    "records": [
        {
            "token": "0000000000000000000000000000000000000",
            "zoneName": "example1.com",
            "zoneIdentifier": "",
            "recordName": "example1.com",
            "recordIdentifier": ""
        },
        {
            "token": "0000000000000000000000000000000000000",
            "zoneName": "example2.com",
            "zoneIdentifier": "",
            "recordName": "example2.com",
            "recordIdentifier": ""
        }
    ]
}
```
#### `token`

Optional; if all of the domain records belong to the same account, a single API Token is enough to manage them. This field's value will be treated as the default token but if a record specifies its own token, that will be used instead.

See [the API token documentation](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) to see how to create one.

#### `records`

The records array contains the list of DNS records the script will manage. Some information will be automatically filled in on startup, so it is important the script has write access to this file.

##### `token`

The API token used to manage the record. If present, this token will be used when updating the record, regardless of the default token.

Optional if the main token field already contains a token that is valid for this record.

See [the API token documentation](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) to see how to create one.

##### `zoneName`

The base domain name where the record applies to. This is the purchased domain name such as "example.com", and is usually the same as the top `A` record's.

Optional if `zoneIdentifier` is filled out from the dashboard; otherwise required and the script will automatically resolve it.

##### `zoneIdentifier`

The identifier of the zone. If not filled out `zoneName` will be used to resolve it and the script will write it to the file. To manually fill in the ID, [you can copy it from the main dashboard](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/#copy-your-zone-id).

##### `recordName`

The name of the [`A` record](https://developers.cloudflare.com/dns/manage-dns-records/reference/dns-record-types/#a-and-aaaa) to update.

##### `recordIdentifier`

The identifier of the record. This will be automatically resolved from `recordName` and written to file.

#### `checkIntervalMS`

Setting this property will keep the script running and sets how often, in milliseconds, it should check if the IP address has changed. If set to 0 or omitted this is disabled.

> [!NOTE]
> Be considerate about the check frequency and set it to a reasonable interval to not spam the IP check service. Generally shouldn't be lower than 30 minutes, (`1800000`ms).

## IP discovery

The script uses [https://www.ipify.org/](https://www.ipify.org/) to check the server's [IPv4](https://api.ipify.org/) address. (They are great <3)

The last known IP address is written to the `.\ipv4` file as plaintext. 

## Logging

Logs are written to `.\log.txt`.