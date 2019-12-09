// @ts-check

const http = require('http');
const pm2 = require('pm2');
const logger = require('pino')()
const elasticsearch = require('elasticsearch');
var client = new elasticsearch.Client({
  hosts: [
    'http://localhost:9200',
  ]
});
// const { Client } = require('@elastic/elasticsearch')
// const client = new Client({ node: 'http://localhost:9200' })

const io = require('@pm2/io');

const prefix = 'pm2';
const labels = ['id', 'name', 'instance', 'interpreter', 'node_version'];
const map = [
  ['up', 'Is the process running'],
  ['cpu', 'Process cpu usage'],
  ['memory', 'Process memory usage'],
  ['uptime', 'Process uptime'],
  ['instances', 'Process instances'],
  ['restarts', 'Process restarts'],
  ['prev_restart_delay', 'Previous restart delay']
];

function pm2c(cmd, args = []) {
  return new Promise((resolve, reject) => {
    pm2[cmd](args, (err, resp) => {
      if (err) return reject(err);
      resolve(resp);
    });
  });
}

function metrics() {
  const pm = {};
  return pm2c('list')
    .then(list => {
      list.forEach(p => {
        logger.debug(p, p.exec_interpreter, '>>>>>>');
        const conf = {
          id: p.pm_id,
          name: p.name,
          instance: p.pm2_env.NODE_APP_INSTANCE,
          interpreter: p.pm2_env.exec_interpreter,
          node_version: p.pm2_env.node_version,
        };

        const values = {
          up: p.pm2_env.status === 'online' ? 1 : 0,
          cpu: p.monit.cpu,
          memory: p.monit.memory,
          uptime: Math.round((Date.now() - p.pm2_env.pm_uptime) / 1000),
          instances: p.pm2_env.instances || 1,
          restarts: p.pm2_env.restart_time,
          prev_restart_delay: p.pm2_env.prev_restart_delay,
        };
        const names = Object.keys(p.pm2_env.axm_monitor);

        for (let index = 0; index < names.length; index++) {
          const name = names[index];

          try {
            let value;
            if (name === 'Loop delay') {
              value = parseFloat(p.pm2_env.axm_monitor[name].value.match(/^[\d.]+/)[0]);
            } else if (name.match(/Event Loop Latency|Heap Size/)) {
              value = parseFloat(p.pm2_env.axm_monitor[name].value.toString().split('m')[0]);
            } else {
              value = parseFloat(p.pm2_env.axm_monitor[name].value);
            }

            if (isNaN(value)) {
              logger.warn('Ignoring metric name "%s" as value "%s" is not a number', name, value);

              continue;
            }

            const metricName = prefix + '_' + name.replace(/[^A-Z0-9]+/gi, '_').toLowerCase();

            values[metricName] = value;
          } catch (error) {
            logger.error(error);
          }
        }
        elasticIndexer(conf, values)
      });
    })
    .catch(err => {
      logger.error(err);
    });
}

function exporter() {
  setInterval(() => {
    metrics()
  }, 10000);
}

async function elasticIndexer(conf, values) {
  try {
    await checkIndices('pm2status-', conf)
    const data = {
      time: Date.now(),
      name: conf.name,
      id: conf.id,
      instance: conf.instance,
      up: values.up,
      cpu: values.cpu,
      memory: values.memory,
      uptime: values.uptime,
      instances: values.instances,
      restarts: values.restarts,
      prev_restart_delay: values.prev_restart_delay || 0,
      pm2_heap_size: values.pm2_heap_size || 0,
      pm2_heap_usage: values.pm2_heap_usage || 0,
      pm2_used_heap_size: values.pm2_used_heap_size || 0,
      pm2_active_requests: values.pm2_active_requests || 0,
      pm2_active_handles: values.pm2_active_handles || 0,
      pm2_event_loop_latency: values.pm2_event_loop_latency || 0,
      pm2_event_loop_latency_p95: values.pm2_event_loop_latency_p95 || 0
    }
    let body = []
    body.push({
      index: {
        _index: 'pm2status-' + conf.name + '-' + 'i' + conf.instance,
        _type: conf.name,
      }
    })
    body.push(data)
    let resultBulk = await client.bulk({
      body: body
    })
    console.log(resultBulk)
  } catch (error) {
    console.log(error)
  }
}

async function putMapping(conf) {
  console.log("Creating Mapping index");
  client.indices.putMapping({
    index: 'pm2status-' + conf.name + '-' + 'i' + conf.instance,
    type: conf.name,
    body: {
      "properties": {
        cpu: {
          type: "float"
        },
        id: {
          type: "long"
        },
        instance: {
          type: "long"
        },
        instances: {
          type: "long"
        },
        memory: {
          type: "long"
        },
        name: {
          type: "text",
          fields: {
            keyword: {
              type: "keyword",
              ignore_above: 256
            }
          }
        },
        pm2_active_handles: {
          type: "long"
        },
        pm2_active_requests: {
          type: "long"
        },
        pm2_event_loop_latency: {
          type: "float"
        },
        pm2_event_loop_latency_p95: {
          type: "float"
        },
        pm2_heap_size: {
          type: "float"
        },
        pm2_heap_usage: {
          type: "float"
        },
        pm2_used_heap_size: {
          type: "float"
        },
        prev_restart_delay: {
          type: "long"
        },
        restarts: {
          type: "long"
        },
        time: {
          type: "date"
        },
        up: {
          type: "long"
        },
        uptime: {
          type: "long"
        }
      }
    }
  }, (err, resp, status) => {
    if (err) {
      console.error(err, status);
    }
    else {
      console.log('Successfully Created Index', status, resp);
    }
  });
}

async function checkIndices(indexName, conf) {
  try {
    const instance = '-' + 'i' + conf.instance
    let index = await client.indices.exists({ index: indexName + conf.name + instance })
    if (!index) {
      await client.indices.create({ index: indexName + conf.name + instance })
    }
    await putMapping(conf)
  } catch (error) {
    console.log(error)
  }
}
exporter();
