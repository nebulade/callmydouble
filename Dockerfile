FROM cloudron/base:0.8.1
MAINTAINER Johannes Zellner <johannes@nebulon.de>

WORKDIR /app/code

ADD bin/ /app/code/bin/
ADD lib/ /app/code/lib/
ADD public/ /app/code/public/
ADD package.json npm-shrinkwrap.json /app/code/

ENV PATH /usr/local/node-4.2.1/bin:$PATH

RUN npm install --production

ENV DEBUG server
CMD [ "/app/code/bin/server" ]
