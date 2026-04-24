import Fastify from 'fastify';

const server = Fastify({ logger: true });

server.get('/health', async () => ({ status: 'ok', phase: 'phase-0' }));

server.get('/api/project', async () => ({
  name: 'Specflow',
  category: 'Continuous Coding',
  phase: 'phase-0',
  flow: [
    'ticket',
    'interview',
    'plan',
    'code draft',
    'implementation review',
    'repair loop',
    'final patch'
  ]
}));

const port = Number(process.env.PORT ?? 3000);

server
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    server.log.info(`Specflow server listening on ${port}`);
  })
  .catch((error) => {
    server.log.error(error);
    process.exit(1);
  });
