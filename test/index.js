var csl = require('../')(__filename)

csl.log('anything/random', {
  random: 'objects can be logged'
})
csl.log('cache/invalidate', {
  partition: 'part',
  row: 'row'
})
csl.log('email/batch', {
  size: 3
})
csl.log('email/sent', {
  subject: 'MessageA',
  to: 'me myself and I'
})
csl.log('email/sent', {
  subject: 'MessageB',
  to: 'me myself and I'
})
csl.log('email/sent', {
  subject: 'MessageC',
  to: 'me myself and I'
})


function testTiming(csl, req, cb) {
  setTimeout(function () {
    csl.info('db/call', {
      name: 'database-methods',
      args: ['are', 'formatted', 'specially'],
      req: req
    })
    csl.info('db/update', {
      statement: 'UPDATE SET update-statements=?',
      values: ['handled'],
      req: req
    })
    cb()
  }, 200)
}

var request = require('request')
var chronicle = require('../')
var app = require('express')()

//if you redirect to undefined, it's a no-op
chronicle.redirect(undefined)

app.use(chronicle.requests(__filename))
app.get('/', function (req, res) {
  testTiming(csl.time(), req, function () {
    res.json(true)
  })
})
app.get('/whoa', function (req, res, next) {
  testTiming(csl.time(), req, function () {
    next(new Error('simulated database error'))
  })
})
app.get('/timeout', function (req, res, next) {
  testTiming(csl.time(), req, function () {
  })
})
app.use(chronicle.errors(__filename))
app.use(function (err, req, res) {
  // default to 500
  if (res.statusCode < 400) res.statusCode = 500

  // respect err.status
  if (err.status) res.statusCode = err.status

  // production gets a basic error message
  var msg = 'production' == env
    ? http.STATUS_CODES[res.statusCode]
    : err.stack || err.toString()

  if (res.headerSent) return req.socket.destroy()
  res.setHeader('Content-Type', 'text/plain')
  res.setHeader('Content-Length', Buffer.byteLength(msg))
  if ('HEAD' == req.method) return res.end()
  res.end(msg)
})
app.listen(3000)

request('http://localhost:3000/', function (err) {
  if (err) throw err
})
request('http://localhost:3000/', function (err) {
  if (err) throw err
})
request('http://localhost:3000/', function (err) {
  if (err) throw err
})
request('http://localhost:3000/whoa', function (err) {
  if (err) throw err
})
request('http://localhost:3000/timeout', function (err) {
  if (err) throw err
})

setTimeout(function () {
  process.exit(0)
}, 15000)