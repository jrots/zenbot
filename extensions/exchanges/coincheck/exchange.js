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
      
      return new CoinCheck.CoinCheck(c.coincheck.key, c.coincheck.secret);
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
  var lastKnownBalance = {}
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
    },
    getBalance: function(opts, cb) {
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
                
                lastKnownBalance = balance
                
                return cb(null, balance);
            },
            error: function(error, response, params) {
              console.log(error);
              
              return cb(null, lastKnownBalance);
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
                console.log(error)
                cb(new Error('get quote failed'));
              }
          }
      };

     client.ticker.all(params);
    },

    cancelOrder: function(opts, cb) {
      var client = authedClient()
      var params = {
        data : {
          id : opts.order_id
        },
        options: {
              success: function(data, response, params) {
                cb()
              },
              error: function(error, response, params) {
                console.log(error)
                cb(new Error('order cancelling failed'));
              }
          }
      };
      
      client.order.cancel(params);
    },

    trade: function(type, opts, cb) {
      var client = authedClient(true)
    
      if (typeof opts.order_type === 'undefined' ) {
        opts.order_type = 'maker'
      }  
      var orderData = {
        pair: 'btc_jpy',
        order_type: ((opts.order_type === 'taker' ? 'market_' : '') + type)
      }
      
      if (opts.order_type === 'taker') {
        if (type === 'buy') {
          orderData['market_buy_amount'] = (opts.size * opts.price);
        } else {
          orderData['amount'] = opts.size;
        }
      } else {
        orderData['amount'] = opts.size;
        orderData['rate'] = opts.price;
      }        
      
      var params = {
        data : orderData,
        options: {
              success: function(data, response, params) {
                  if (typeof data === 'string') {
                    data = JSON.parse(data);
                  }
                  var order = {
                    id: data && data.id ? data.id : null,
                    status: 'open',
                    price: data.rate,
                    size: data.amount,
                    created_at: new Date().getTime()
                  }

                  if (opts.order_type === 'maker') {
                    order.post_only = !!opts.post_only
                  } else {
                    order.done_at = new Date().getTime()
                    order.status = 'done'
                  }

                  if (!data.success) {
                      order.status = 'rejected'
                      order.reject_reason = 'balance'
                      return cb(null, order)
                  }

                  orders['~' + data.id] = order
                  cb(null, order)
              },
              error: function(error, response, params) {
                console.log(error);
                var order = {
                  id: null,
                  status: 'rejected',
                  reject_reason: 'balance',
                  price: data.rate,
                  size: data.amount,
                  created_at: new Date().getTime()
                }
                return cb(null, order)
              }
          }
      };
      client.order.create(params);
      
      /* TESTING if you dont want to trade for real. (was to debug issue with getbalance mainly)
      var order = {
        id: Date.now(),
        status: 'done',
        price: orderData.rate,
        size: orderData.amount,
        created_at: new Date().getTime(),
        done_at: new Date().getTime()
      }
      orders['~' + order.id] = order
      
      cb(null, order);
      */
      
    },

    buy: function(opts, cb) {
      exchange.trade('buy', opts, cb)
    },

    sell: function(opts, cb) {
      exchange.trade('sell', opts, cb)
    },

    getOrder: function(opts, cb) {
      var client = authedClient()
      var args = [].slice.call(arguments)
      var order = orders['~' + opts.order_id]
      if (!order) return cb(new Error('order not found in cache'))
        
      var client = authedClient()
        if (order['status'] === 'done') {
          return cb(null, order);
        }
        
      var params = {
        options: {
              success: function(data, response, params) {
                  if (typeof data === 'string') {
                    data = JSON.parse(data);
                  }
                  if (data && data.orders.length > 0) {
                    var done = true;
                    for (var i=0;i<data.orders.length;i++)
                    {
                      if ( data.orders[i]['id'] === order['id'] ) {
                        done = false;
                        break;
                      }
                    }
                  }
                  if (done) {
                    order.done_at = new Date().getTime()
                    order.status = 'done';
                  }
                  cb(null, order);
              },
              error: function(error, response, params) {
                  console.log('error', error);
                  cb(new Error('order not found in cache'));
              }
          }
      };
      
      client.order.opens(params);
    },

    // return the property used for range querying.
    getCursor: function(trade) {
      return (trade.time || trade)
    }
  }
  return exchange
}
