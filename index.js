'use strict';

// Make sure lines are splited correctly
// http://stackoverflow.com/questions/1155678/javascript-string-newline-character
const NEW_LINE = /\r\n|\n|\r/
const NEW_LINE_NOSPACE = /(\r\n|\n|\r)(?!\s)/;
const NEW_LINE_SPACE = /(\r\n|\n|\r)+ ?/;
const path = require("path");
const fs = require("fs");
const Q = require("q");
const cwd = process.cwd();

/**
 * Take ical string data and convert to JSON
 *
 * @param {string} source
 * @returns {Object}
 */
const convert = source => {
  const lines = source.split(NEW_LINE_NOSPACE)
  const section = []
  let currentEvent = {}
  let lastKey = ''
  let ret

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(NEW_LINE_SPACE, '')

    if (line.match(NEW_LINE) || line.match(/^$/) || line.match(/BEGIN:VCALENDAR/) || line.match(/END:VCALENDAR/)) {
      continue
    } else if (line.match(/^BEGIN:/)) {
      const newSection = line.replace(/^BEGIN:/, '')
      section.push(newSection)
      if (!ret) {
        ret = currentEvent
      } else {
        ret[newSection] = (ret[newSection] || []).concat(currentEvent)
      }
      currentEvent = {}
    } else if (line.match(/^END:/) ) {
      const closeSection = line.replace(/^END:/, '')
      const shouldClose = section.pop()
      if (shouldClose !== closeSection) {
        console.error('closing section doesnt map expectation', closeSection, shouldClose)
      }
    } else if (line.match(/^[A-Z\-]+;/)) {
      const o = line.split(';')
      const v = o.slice(1).reduce((acc, cur) => {
        const p = cur.split('=')
        return Object.assign({}, acc, {
          [p[0]]: p[1]
        })
      }, {})
      currentEvent[o[0]] = (currentEvent[o[0]] || []).concat(v)
    } else if (line.match(/^[A-Z\-]+:/)) {
      const p = line.split(':')
      lastKey = p[0]
      currentEvent[lastKey] = p[1]
    } else {
      console.error('error parsing line:', line)
    }
  }

  return Object.assign({}, ret)
}

/**
 * Take JSON, revert back to ical
 * @param {Object} object
 * @return {String}
 */
function revert(object) {
  let lines = [];

  for (let key in object) {
    let value = object[key];
    if (Array.isArray(value)) {
      value.forEach((item) => {
        lines.push(`BEGIN:${key}`);
        lines.push(revert(item));
        lines.push(`END:${key}`);
      });
    } else {
      let fullLine = `${key}:${value}`;
      do {
        // According to ical spec, lines of text should be no longer
        // than 75 octets
        lines.push(fullLine.substr(0, 75));
        fullLine = ' ' + fullLine.substr(75);
      } while (fullLine.length > 1);
    }
  }

  return lines.join('\n');
};

/**
 * Pass in options to parse and generate JSON files
 * @param {Object} options
 * @return {Promise}
 */
function run(options) {
  let files, filePromises = [];
  files = options.args || [];

  for (let i = 0; i < files.length; i++) {
    let file = files[i];
    let filePath = path.resolve(cwd, file);

    if (!fs.existsSync(filePath)) {
      continue;
    }

    let stat = fs.statSync(filePath);
    let ext = path.extname(filePath);

    let isConvert = !options.revert && ext === '.ics'
    let isRevert = options.revert && ext === '.json'

    if (!stat.isFile() || (!isConvert && !isRevert)) {
      continue;
    }

    filePromises.push(Q.nfcall(fs.readFile, filePath)
    .then((buffer) => {
      let output;
      let data = buffer.toString();

      if (isConvert) {
        output = convert(data);
        output = JSON.stringify(output, null, "  ");
      } else if (isRevert) {
        output = revert(data);
      }

      let basename = path.basename(filePath, ext);
      let dirname = path.dirname(filePath);
      let compiledExt = isConvert ? '.json' : '.ics';
      let writePath = path.join(dirname, basename) + compiledExt;

      return Q.nfcall(fs.writeFile, writePath, output);
    })
    .fail((error) => {
      throw new Error(error);
    }));
  }

  return Q.all(filePromises);
};

module.exports = {
  run: run,
  revert: revert,
  convert: convert
};
