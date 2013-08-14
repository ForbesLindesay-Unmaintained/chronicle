'use strict'

var color = require('bash-color')
var util = require('util')

var startup = (new Date()).toISOString()
var id = -100000000000000

module.exports = console
module.exports.output = output

function console(filename, startTime) {
  var csl = {}
  csl.log = logger(filename, startTime, 'log')
  csl.info = logger(filename, startTime, 'info')
  csl.warn = logger(filename, startTime, 'warn')
  csl.error = logger(filename, startTime, 'error')
  csl.time = function () {
    return console(filename, new Date())
  }
  return csl
}

function logger(filename, start, level) {
  return function (type, obj) {
    var result = {type: type, timestamp: new Date()}
    if (type === 'server/request') {
      obj = obj.req
      obj.__chronicle_id__ = startup + '-' + (id++)
      obj.__chronicle_start__ = new Date()
      result.requestID = obj.__chronicle_id__
      result.httpVersion = obj.httpVersion
      result.headers = obj.req.headers
      result.method = obj.req.method
      result.url = obj.req.url
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
function output(message, indent) {
  indent = indent || ''
  if (message.requestID && message.type === 'server/request') {
    loggingRequests[message.requestID] = {
      req: message,
      logs: [],
      res: null,
      timeout: setTimeout(function () {
        loggingRequests[message.requestID].res = {type: 'server/timeout', level: 'warn', timestamp: new Date()}
        outputRequest(message.requestID)
      }, 10000)
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
      log(type + message.name + message.args.map(formatInline).join(', ') + duration)
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
}
function outputRequest(requestID) {
  if (!loggingRequests[requestID]) return
  clearTimeout(loggingRequests[requestID].timeout)
  var msg = loggingRequests[requestID]
  loggingRequests[requestID] = null

  var log = console[msg.res.level] || console.log
  console.log(msg.req.method.toUpperCase() + ' ' + color[c](msg.res.statusCode || 'TIMEOUT') + msg.req.url
    + color.purple(' (' + (message.res.duration || (message.res.timestamp - message.req.timestamp)) + 'ms)'))
  for (var i = 0; i < msg.logs.length; i++) {
    output(msg.logs[i], '  ')
  }
}

function formatInline(arg) {
  return util.inspect(arg, false, 3, true).replace(/^ */gm, '').replace(/ *$/gm, ' ').replace(/\n/g, '').trim()
}



function clone(obj, circular) {
  circular = circular || []
  if (typeof obj !== 'object') {
    return obj
  }
  if (Array.isArray(obj)) {
    obj = obj.map(function (v) {
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
      if (circular.indexOf(obj[key]) != -1) {
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