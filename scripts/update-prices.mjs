import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function updatePrices() {
    console.log('Updating all product prices to 59.90...');
    try {
        const res = await pool.query('UPDATE public.products SET price = 59.90');
        console.log(`Successfully updated ${res.rowCount} products to 59.90.`);
    } catch (err) {
        console.error('Error updating prices:', err);
    } finally {
        await pool.end();
    }
}

updatePrices();
