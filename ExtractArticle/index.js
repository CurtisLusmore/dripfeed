const { JSDOM } = require('jsdom');
const { Readability } = require('readability-node');
const request = require('request-promise');
const sgMail = require('@sendgrid/mail');
const wordCount = require('html-word-count');

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:61.0) Gecko/20100101 Firefox/61.0',
};

module.exports = async function (context, req) {
    context.log('start');
    if (!req.query.url || !req.query.email) {
        context.log('fail');
        context.res = {
            status: 400,
            body: 'Please pass a url and email in the query string'
        };
        return;
    }

    const url = req.query.url;
    const email = req.query.email;
    const mode = req.query.mode || 'now';
    const time = req.query.time || '';
    const parts = time.split(':');

    if (mode === 'daily' && parts.length !== 2) {
        context.log('fail');
        context.res = {
            status: 400,
            body: 'Invalid time.'
        };
        return;
    }

    const deliveryTime = +parts[0] * 60 + +parts[1];
    const date = new Date();
    const currentTime = date.getHours() * 60 + date.getMinutes();
    if (currentTime > deliveryTime) date.setDate(date.getDate() + 1);
    date.setHours(0, deliveryTime, 0, 0);

    const minutes = req.query.minutes || 15;
    const wpm = req.query.wpm || 200;
    const wordLimit = req.query.wordLimit || (minutes * wpm);

    try {
        const options = {
            uri: url,
            headers
        };

        const body = await request(options);

        const dom = new JSDOM(body);
        const document = dom.window.document;
        const { title, elements } = extractArticle(document);
        if (!title) {
            context.log('fail');
            context.res = {
                status: 400,
                body: 'Unable to extract article.'
            };
            return;
        }
        const snippets = getSnippets(elements, wordLimit);
        const contents = snippets.map(snippet => container(document, snippet).outerHTML);
        const count = contents.length;

        context.log(`sending ${count} emails`);
        const sendTime = Math.floor(date.getTime() / 1000);
        sgMail.setApiKey(process.env['sendgrid_api_key']);
        const emails = contents.map((content, index) => {
            const msg = {
                to: email,
                from: 'dripfeed <dripfeed@lusmo.re>',
                subject: `${title} (${index+1}/${count})`,
                html: content
            };
            if (mode === 'daily') msg.sendAt = sendTime + index*24*60*60;
            console.log(msg.sendAt);
            return msg;
        });
        await sgMail.send(emails);

        context.log('success');
        context.res = {
            status: 200,
            body: { title, count },
            headers: { 'Content-Type': 'application/json' }
        };
        return;
    } catch (err) {
        context.log('error');
        context.log(err);
        context.res = {
            status: 500,
            body: err,
            headers: { 'Content-Type': 'application/json' }
        };
        return;
    }
};

Array.prototype.flatMap = function (f) {
    return this.map(f).reduce((prev, curr) => [...prev, ...curr], []);
};

function extractArticle(document) {
    const result = new Readability('', document).parse();
    if (!result) return { title: null, elements: []}
    const { title, content } = result;
    const dom = new JSDOM(content);
    const elements = Array.from(dom.window.document.body.children)
        .flatMap(child => Array.from(child.children)
            .flatMap(child => Array.from(child.children)));
    return { title, elements };
};

function getSnippet(elements, wordLimit) {
    const { used, unused } = elements.reduce(
        ({ done, words, used, unused }, element, ) => {
            const count = wordCount(element.outerHTML);
            return !done && words < wordLimit
                ? { done: false, words: words + count, used: [...used, element], unused }
                : { done: true, words, used, unused: [...unused, element] }
        },
        { done: false, words: 0, used: [], unused: [] }
    );
    return { used, unused };
};

function getSnippets(elements, wordLimit) {
    const snippets = [];
    while (elements.length) {
        const { used, unused } = getSnippet(elements, wordLimit);
        snippets.push(used);
        elements = unused;
    }
    return snippets;
};

function container(document, children, tagName='div') {
    const element = document.createElement(tagName);
    children.forEach(child => element.appendChild(child));
    return element;
};