FROM cloudron/base:0.8.1
MAINTAINER Johannes Zellner <johannes@nebulon.de> <johannes@nebulon.de>

WORKDIR /app/code

ADD bin/ lib/ package.json npm-shrinkwrap.json /app/code/

ENV PATH /usr/local/node-4.2.1/bin:$PATH

RUN npm install --production

CMD [ "/app/code/bin/server" ]
