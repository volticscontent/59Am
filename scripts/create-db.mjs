import pkg from 'pg';
const { Client } = pkg;

async function createDb() {
    const client = new Client({
        connectionString: 'postgres://postgres:3ad3550763e84d5864a7@easypanel.landcriativa.com:9000/postgres?sslmode=disable',
    });

    try {
        await client.connect();
        // Check if db exists
        const res = await client.query("SELECT 1 FROM pg_database WHERE datname='dg'");
        if (res.rowCount === 0) {
            await client.query('CREATE DATABASE dg');
            console.log('Database dg created');
        } else {
            console.log('Database dg already exists');
        }
    } catch (error) {
        console.error('Failed to create database', error);
    } finally {
        await client.end();
    }
}

createDb();
