import fs from 'fs';
import path from 'path';
import pkg from 'pg';
const { Client } = pkg;

// Simple .env parser to avoid needing dotenv dependency
function loadEnv() {
    try {
        const envPath = path.resolve('.env');
        if (fs.existsSync(envPath)) {
            const envFile = fs.readFileSync(envPath, 'utf8');
            envFile.split('\n').forEach(line => {
                const match = line.match(/^([^=]+)=(.*)$/);
                if (match) {
                    process.env[match[1].trim()] = match[2].trim();
                }
            });
        }
    } catch (err) {
        console.error('Error loading .env file', err);
    }
}

loadEnv();

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
    console.error('DATABASE_URL is missing in .env');
    process.exit(1);
}

const client = new Client({
    connectionString: dbUrl,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function run() {
    try {
        await client.connect();
        console.log('Connected to PostgreSQL successfully.');

        // Create table using `handle` as `sku`
        const createTableQuery = `
      CREATE TABLE IF NOT EXISTS public.products (
        sku VARCHAR(255) PRIMARY KEY,
        product_id BIGINT,
        variant_id BIGINT,
        price DECIMAL(10, 2),
        currency VARCHAR(3) DEFAULT 'EUR',
        stock INTEGER DEFAULT 100,
        data JSONB
      );
    `;
        await client.query(createTableQuery);
        console.log('Table "products" ensured in schema "public".');

        // Read the full products json containing descriptions, images, tags, etc.
        const dataPath = path.resolve('src/data/products.json');
        const productsFile = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        // The products array is inside the 'products' key in products.json
        const productsData = productsFile.products || [];

        console.log(`Found ${productsData.length} records to import.`);

        // TRUNCATE the table so we don't have dangling legacy rows from the 'handle' sku format
        await client.query('TRUNCATE TABLE public.products');
        console.log('Cleared existing data to replace with new schema');

        let inserted = 0;
        for (const item of productsData) {
            // Find the primary variant or default to something safe 
            const variant = item.variants && item.variants.length > 0 ? item.variants[0] : null;
            // We need a fallback product_id and variant_id if they aren't directly on the top level
            const productId = item.id ? parseInt(item.id.replace(/\D/g, ''), 10) || 0 : 0;
            const variantId = variant && variant.id ? parseInt(variant.id.replace(/\D/g, ''), 10) || 0 : 0;

            const query = `
        INSERT INTO public.products (sku, product_id, variant_id, price, currency, stock, data)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (sku) DO UPDATE SET
          price = EXCLUDED.price,
          product_id = EXCLUDED.product_id,
          variant_id = EXCLUDED.variant_id,
          data = EXCLUDED.data;
      `;
            const values = [
                variantId.toString(), // Using variantId as SKU as requested
                productId,
                variantId,
                item.price,
                item.currency || 'EUR',
                variant && variant.inventory !== undefined ? variant.inventory : 100,
                JSON.stringify(item) // Storing full object
            ];

            await client.query(query, values);
            inserted++;
        }

        console.log(`Successfully imported/updated ${inserted} records.`);
    } catch (error) {
        console.error('Error during import:', error);
    } finally {
        await client.end();
    }
}

run();
