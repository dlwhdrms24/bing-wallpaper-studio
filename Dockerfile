FROM node:22-alpine AS build
WORKDIR /app
COPY build.mjs ./
COPY public ./public
COPY src ./src
RUN node build.mjs

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4179
COPY package.json server.mjs ./
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4179
CMD ["node", "server.mjs"]
