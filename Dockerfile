FROM ghcr.io/puppeteer/puppeteer:21.3.8

COPY ./ /usr/src/app
WORKDIR /usr/src/app

USER root

RUN chown -R pptruser:pptruser .

RUN apt update
RUN apt install -y xvfb

USER pptruser

RUN npm install

# Install browser
RUN node node_modules/puppeteer/install.mjs

CMD [ "npm", "run", "start" ]