const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')

const moment = require('moment')

const request = requestFactory({
  debug: false,
  cheerio: true,
  json: false,
  jar: true
})

const vendor = 'thomann'
const baseUrl = 'https://www.thomann.de'
const loginUrl = `${baseUrl}/intl/mythomann_login.html`
const ordersListUrl = `${baseUrl}/intl/mythomann_orderlist.html`

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of documents')
  const $ = await request(ordersListUrl)

  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields, {
    identifiers: [vendor],
    contentType: 'application/pdf'
  })
}

// this shows authentication using the [signin function](https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin)
// even if this in another domain here, but it works as an example
function authenticate(username, password) {
  return signin({
    url: loginUrl,
    formSelector: `form[method='post']`,
    formData: {
      uname: username,
      passw: password
    },
    validate: (statusCode, $) => {
      if ($('svg.rs-icon-cc-sb-logout').length === 1) {
        return true
      } else {
        return false
      }
    }
  })
}

// The goal of this function is to parse a html page wrapped by a cheerio instance
// and return an array of js objects which will be saved to the cozy by saveBills (https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#savebills)
async function parseDocuments($) {
  const orders = scrape(
    $,
    {
      date: {
        sel: '.order-date',
        parse: date => parseDate(date)
      },
      number: {
        sel: '.order-nr'
      },
      amount: {
        sel: '.order-sum',
        parse: amount => parseAmount(amount)
      },
      currency: {
        sel: '.order-sum',
        parse: currency => parseCurrency(currency)
      },
      details: {
        sel: '.details a',
        attr: 'href'
      }
    },
    '.order-entry'
  )

  for (let i = 0; i < orders.length; ++i) {
    let order = orders[i]
    const $details = await request(order.details)
    order['pdf'] = $details('.orderdata a.tr-link-pdf').attr('href')
  }

  return orders.map(order => {
    const filename = `${order.date.format('YYYY-MM-DD')}_${vendor}.pdf`

    return {
      vendor: vendor,
      date: order.date.toDate(),
      amount: order.amount,
      currency: order.currency,
      fileurl: order.pdf,
      filename: filename,
      metadata: {
        importDate: new Date(),
        version: 1
      }
    }
  })
}

function parseAmount(price) {
  const amountStr = price
    .trim()
    .slice(price.indexOf(':') + 1, price.length)
    .slice(0, price.length - 1)
    .replace(',', '.')

  return parseFloat(amountStr)
}

function parseCurrency(price) {
  return price.trim()[price.length - 1]
}

function parseDate(date) {
  const dateStr = date.slice(date.lastIndexOf(' ') + 1, date.length).trim()
  return moment.utc(dateStr, 'DD.MM.YYYY')
}
