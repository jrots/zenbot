module.exports = {
  _ns: 'zenbot',

  'exchanges.coincheck': require('./exchange'),
  'exchanges.list[]': '#exchanges.coincheck'
}