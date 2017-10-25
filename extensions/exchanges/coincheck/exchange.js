var CoinCheck = require('coincheck'),
  path = require('path'),
  minimist = require('minimist'),
  moment = require('moment'),
  n = require('numbro'),
  colors = require('colors')
var WebSocketClient = require('websocket').client;

module.exports = function container(get, set, clear) {
  var c = get('conf')
  var s = {
    options: minimist(process.argv)
  }
  var so = s.options

  var public_client, authed_client
  // var recoverableErrors = new RegExp(/(ESOCKETTIMEDOUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|API:Invalid nonce|API:Rate limit exceeded|between Cloudflare and the origin web server)/)
  var recoverableErrors = new RegExp(/(ESOCKETTIMEDOUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|API:Invalid nonce|between Cloudflare and the origin web server)/)
  var silencedRecoverableErrors = new RegExp(/(ESOCKETTIMEDOUT|ETIMEDOUT)/)

  function publicClient() {
    if (!public_client) {
      public_client = new CoinCheck.CoinCheck('YOUR-API-KEY', 'YOUR-API-SECRET');
    }
    return public_client
  }

  function authedClient() {
    if (!authed_client) {
      if (!c.coincheck || !c.coincheck.key || c.coincheck.key === 'YOUR-API-KEY') {
        throw new Error('please configure your Coincheck credentials in conf.js')
      }
      authed_client = new CoinCheck.CoinCheck(c.coincheck.key, c.coincheck.secret);
    }
    return authed_client
  }
  
  
  var coinCheckTrades =
  [
    {
      trade_id: 0,
      time:1000,
      size: 0,
      price: 0,
      side: ''
    }
  ]
  
  var tradesClient = new WebSocketClient();
  tradesClient.on('connect', function(connection) {
      console.log('WebSocket Client Connected');
      connection.on('error', function(error) {
          console.log("Connection Error: " + error.toString());
      });
      connection.on('close', function() {
          console.log('echo-protocol Connection Closed');
      });
      connection.on('message', function(message) {
          if (message.type === 'utf8') {
            data = JSON.parse(message.utf8Data);
            //[31455698,"btc_jpy","623320.0","0.1","sell"]
            coinCheckTrades.push( {
              trade_id: data[0],
              time: (new Date().getTime()),
              size: parseFloat(data[3]),
              price: parseFloat(data[2]),
              side: data[4]
            })
            if (coinCheckTrades.length > 200) coinCheckTrades.splice(0,100)
          
          }
      });
    
      function subscribeToTrades() {
          if (connection.connected) {
            connection.sendUTF(JSON.stringify({type: "subscribe", channel: "btc_jpy-trades"}))
          }
      }
      subscribeToTrades();
  });
  tradesClient.connect('ws://ws-api.coincheck.com/');  

  var orders = {}
  var startTime = new Date().getTime()
  var initialTrades = false
  var liveTrading = true
  var exchange = {
    name: 'coincheck',
    historyScan: 'forward',
    makerFee: 0,
    takerFee: 0,
    // The limit for the public API is not documented, 1750 ms between getTrades in backfilling seems to do the trick to omit warning messages.
    backfillRateLimit: 3500,
    intitialTrades: false,
    getProducts: function() {
      return require('./products.json')
    },
    
    getTrades: function(opts, cb) {
      var t = coinCheckTrades
      var trades = t.map(function (trade) {
        return (trade)
      })
      cb(null, trades)
      /*if (!liveTrading) {
        var now = new Date().getTime();
        if ((opts.from < now) && initialTrades != false) {
          return cb(null, initialTrades);
        }
      }
      
      var client = publicClient()
      var params = {
          options: {
            success: function(data, response, params) {
              if (typeof data === 'string') {
                data = JSON.parse(data);
              }
              var trades = data.map(function (trade) {
                return {
                  trade_id: trade.id,
                  time: new Date(trade.created_at).getTime(),
                  size: Number(trade.amount),
                  price: Number(trade.rate),
                  side: trade.order_type
                }
              })
             
              if (initialTrades == false) {
                initialTrades = trades
              }
              
              cb(null, trades);
            },
            error: function(error, response, params) {
              cb(error);
          }
        }
      };
      client.trade.all(params);*/
    },
    getBalance: function(opts, cb) {
      console.log("GET BALANCE");
      liveTrading = true;
      var client = authedClient()
      var params = {
          options: {
            success: function(data, response, params) {
              if (typeof data === 'string') {
                data = JSON.parse(data);
              }
              
                var balance = {asset: 0, currency: 0}
                balance.currency =  data[opts.currency.toLowerCase()]
                balance.currency_hold = data[opts.currency.toLowerCase()+"_reserved"]
                balance.asset = data[opts.asset.toLowerCase()]
                balance.currency_hold = data[opts.asset.toLowerCase()+"_reserved"]
                
                cb(null, balance);
            },
            error: function(error, response, params) {
              cb(error);
          }
        }
      };
      client.account.balance(params);
    },

    getQuote: function(opts, cb) {
      var client = publicClient()
      var params = {
      options: {
              success: function(data, response, params) {
                if (typeof data === 'string') {
                  data = JSON.parse(data);
                }
                cb(null, {bid: data.bid, ask: data.ask})
              },
              error: function(error, response, params) {
                cb(error);
              }
          }
      };

     client.ticker.all(params);
    },

    cancelOrder: function(opts, cb) {
      console.log('CANCEL')
      console.log(opts)      
      cb(null);      
    },

    trade: function(type, opts, cb) {
      console.log('TRADE?')
      console.log(opts)      
      cb(null);      
    },

    buy: function(opts, cb) {
      console.log('BUYING')
      console.log(opts)
      cb();      
    },

    sell: function(opts, cb) {
      console.log('SELLING')
      console.log(opts)
      cb();      
    },

    getOrder: function(opts, cb) {
      cb();      
    },

    // return the property used for range querying.
    getCursor: function(trade) {
      return (trade.time || trade)
    }
  }
  return exchange
}
