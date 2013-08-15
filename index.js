'use strict'

var util = require('util')
var path = require('path')

var color = require('bash-color')
var mongojs = require('mongojs')

var startup = (new Date()).toISOString()
var requestID = 0
var lastMessage = (new Date()).toISOString()
var messageID = 0

module.exports = makeConsole
module.exports.output = output
module.exports.redirect = redirect
module.exports.console = makeConsole
module.exports.root = root
module.exports.rootPath = process.cwd()

module.exports.requests = requests
module.exports.errors = errors
module.exports.handleGlobalErrors = handleGlobalErrors

function makeConsole(filename, startTime) {
  var csl = {}
  csl.log = logger(filename, startTime, 'log')
  csl.info = logger(filename, startTime, 'info')
  csl.warn = logger(filename, startTime, 'warn')
  csl.error = logger(filename, startTime, 'error')
  csl.time = function () {
    return makeConsole(filename, new Date())
  }
  return csl
}

function logger(filename, start, level) {
  return function (type, obj) {
    var result = {type: type, timestamp: new Date()}
    if (type === 'server/request') {
      obj = obj.req
      obj.__chronicle_id__ = startup + '-' + (requestID++)
      obj.__chronicle_start__ = new Date()
      result.requestID = obj.__chronicle_id__
      result.httpVersion = obj.httpVersion
      result.headers = obj.headers
      result.method = obj.method
      result.url = obj.url
    } else if (type === 'server/response') {
      result.requestID = obj.req.__chronicle_id__
      result.statusCode = obj.res.statusCode
      result.duration = ((new Date()) - obj.req.__chronicle_start__)
    } else if (obj instanceof Error) {
      result.message = obj.stack || obj.message
      result.raw = true
    } else if (typeof obj === 'string') {
      result.message = obj
      result.raw = true
    } else {
      obj = clone(obj)
      for (var key in obj) {
        result[key] = obj[key]
      }
    }
    if (obj.req && obj.req.__chronicle_id__) {
      result.requestID = obj.req.__chronicle_id__
      if ('req' in result) delete result.req
    }
    if (start) {
      result.duration = ((new Date()) - start)
    }
    if (filename) {
      result.filename = filename
    }
    if (level) {
      result.level = level
    }
    module.exports.output(result)
  }
}


var loggingRequests = {}
function output(message, indent, callback) {
  indent = indent || ''
  if (message.requestID && message.type === 'server/request') {
    loggingRequests[message.requestID] = {
      req: message,
      logs: [],
      res: null,
      timeout: setTimeout(function () {
        loggingRequests[message.requestID].res = {type: 'server/timeout', level: 'warn', timestamp: new Date()}
        outputRequest(message.requestID)
      }, 60000)
    }
    return
  } else if (message.requestID && message.type === 'server/response' && loggingRequests[message.requestID]) {
    clearTimeout(loggingRequests[message.requestID].timeout)
    loggingRequests[message.requestID].res = message
    outputRequest(message.requestID)
    return
  } else if (message.requestID && loggingRequests[message.requestID]) {
    loggingRequests[message.requestID].logs.push(message)
    return
  }

  var _log = console[message.level] || console.log
  function log(str) {
    _log(str.toString().replace(/^/gm, indent))
  }
  var duration = message.duration ? color.purple(' (' + message.duration + 'ms)') : ''
  var type = color.cyan(message.type) + ' '
  switch (message.type) {
    case 'db/call':
      log(type + message.name + '(' + message.args.map(formatInline).join(', ') + ')' + duration)
      break
    case 'db/update':
      var index = 0
      log(type + message.statement.replace(/\?/g, function () {
        return formatInline(message.values[index++])
      }) + duration)
      break
    case 'cache/invalidate':
    case 'cache/get':
    case 'cache/set':
      log(type + formatInline(message.partition) + ' ' + formatInline(message.row))
      break
    case 'email/sent':
      log(type + formatInline(message.subject) + ' to ' + formatInline(message.to))
      break
    case 'email/batch':
      log(type + ' size: ' + formatInline(message.size))
      break
    default:
      log(type + duration)
      indent += '  '
      log(message.raw ? message.message : util.inspect(message, false, 10, true))
  }
  if (typeof callback === 'function') {
    setTimeout(callback, 0)
  }
}
function outputRequest(requestID) {
  if (!loggingRequests[requestID]) return
  clearTimeout(loggingRequests[requestID].timeout)
  var msg = loggingRequests[requestID]
  loggingRequests[requestID] = null

  var log = console[msg.res.level] || console.log
  var c = 'green'
  if (msg.res.statusCode >= 300 && msg.res.statusCode < 400) {
    c = 'purple'
  } else if (msg.res.statusCode >= 400 && msg.res.statusCode < 500) {
    c = 'yellow'
  } else if (msg.res.statusCode >= 500 || !msg.res.statusCode) {
    c = 'red'
  }
  console.log(msg.req.method.toUpperCase() + ' ' + color[c](msg.res.statusCode || 'TIMEOUT') + ' ' + msg.req.url
    + color.purple(' (' + (msg.res.duration || (msg.res.timestamp - msg.req.timestamp)) + 'ms)'))
  for (var i = 0; i < msg.logs.length; i++) {
    output(msg.logs[i], '  ')
  }
}

function formatInline(arg) {
  return util.inspect(arg, false, 3, true).replace(/^ */gm, '').replace(/ *$/gm, ' ').replace(/\n/g, '').trim()
}


function redirect(db, collection) {
  if (db !== undefined) {
    db = mongojs(db, [collection || 'chronicle'])
    module.exports.output = function (message, indent, callback) {
      var timestamp = (new Date()).toISOString()
      if (timestamp !== lastMessage) {
        lastMessage = timestamp
        messageID++
      } else {
        messageID = 0
      }
      message._id = timestamp + '-' + (messageID++)
      if (message.filename) {
        message.filename = path.relative(module.exports.rootPath, message.filename).replace(/\\/g, '/')
      }
      db[collection || 'chronicle'].insert(message, function (err) {
        if (err) console.error(err.stack || err.message || err)
        if (typeof callback === 'function') {
          callback(err)
        }
      })
    }
  }
  return module.exports
}
function root(path) {
  module.exports.rootPath = path
  return module.exports
}
function requests(filename) {
  return function (req, res, next) {
    logger(filename, null, 'log')('server/request', {req: req})
    var end = res.end;
    res.end = function(chunk, encoding){
      res.end = end;
      res.end(chunk, encoding);
      logger(filename, null, res.statusCode >= 400 ? 'error' : 'log')('server/response', {
        req: req,
        res: res
      })
    };
    next()
  }
}
function errors(filename, options) {
  return function (err, req, res, next) {
    logger(filename, null, 'error')('server/error', {
      message: err.stack || err.message || err,
      raw: true,
      req: req
    })
    if (!(options && options.last)) next(err)
  }
}

function handleGlobalErrors() {
  process.once('uncaughtException', onUncaughtException);
  module.exports.handleGlobalErrors = function () {}
  return module.exports
}

function onUncaughtException(err) {
  output({
    type: 'application/crash',
    level: 'error',
    message: err.stack || err.message || err,
    raw: true,
    timestamp: new Date()
  }, '', function () {
    throw err
  })
}


function clone(obj, circular) {
  circular = circular || []
  if (typeof obj !== 'object') {
    return obj
  }
  if (Array.isArray(obj)) {
    obj = obj.map(function (v) {
      if (typeof v !== 'object') return v
      if (circular.indexOf(v) != -1) return undefined
      circular.push(v)
      return v
    })
    for (var i = 0; i < obj.length; i++) {
      obj[i] = clone(obj[i], circular)
    }
    return obj
  } else if (obj) {
    var res = {}
    for (var key in obj) {
      if (typeof obj[key] !== 'object') {
        res[key] = obj[key]
      } else if (circular.indexOf(obj[key]) != -1) {
        res[key] = undefined
      } else {
        circular.push(obj[key])
        res[key] = obj[key]
      }
    }
    for (var key in res) {
      res[key] = clone(res[key], circular)
    }
    return res
  } else {
    return obj
  }
}