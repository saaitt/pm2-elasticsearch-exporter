

# PM2 Metrics with ELK 
exports data from each process or cluster by creating individual indices.


#### Clone and run as a seperate application

```shell
    $ git https://github.com/saaitt/pm2-elasticsearch-exporter.git
    $ npm install
    $ pm2 start exporter.js --name pm2-metrics
```
### Setup 
each index is named like : 
```
 pm2status-{Process Name}-i{Instance Number}
```
Add your indices to kibana and have fun monitoring your services with ELK
