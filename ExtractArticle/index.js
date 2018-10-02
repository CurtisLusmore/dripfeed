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
        context.log(req.query);
        context.res = {
            status: 400,
            body: "Please pass a url and email in the query string",
            headers: { 'Content-Type': 'application/json' }
        };
        return;
    }

    const url = req.query.url;
    const email = req.query.email;
    context.log({ url, email });

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
        const snippets = getSnippets(elements, wordLimit);
        const contents = snippets.map(snippet => container(document, snippet).outerHTML);
        const count = contents.length;
        
        sgMail.setApiKey(process.env['sendgrid_api_key']);
        await sgMail.send(contents.map((content, index) => ({
            to: email,
            from: 'dripfeed <dripfeed@lusmo.re>',
            subject: `${title} (${index+1}/${count})`,
            html: content
        })));

        context.log('success');
        context.log({ title });
        context.res = {
            status: 204
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



function extractArticle(document) {
    const { title, content } = new Readability('', document).parse();
    const dom = new JSDOM(content);
    const elements = Array.from(dom.window.document.body.children[0].children[0].children);
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