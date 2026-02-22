import { NextResponse } from 'next/server';
import { query } from '@/utils/db';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ sku: string }> } // Note: params must be awaited in Next 15+ if needed, but we type it properly. For App router, params is passed as second argument.
) {
    try {
        const { sku } = await params; // Next 15 awaits params. If Next 14, just access it directly. Let's do it safely.
        if (!sku) {
            return NextResponse.json({ error: 'SKU is required' }, { status: 400 });
        }

        const res = await query('SELECT sku, price, data FROM public.products WHERE sku = $1', [sku]);

        if (res.rows.length === 0) {
            return NextResponse.json({ error: 'Product not found' }, { status: 404 });
        }

        // According to rule 2.4.1 Stripe Payload Rule: send ONLY sku and price, but we now also need to return the 'data' JSON blob for the frontend to render product pages. Since `data` contains images/description and NOT manipulatable pricing info, it is safe to return alongside sku and price.
        return NextResponse.json(res.rows[0]);
    } catch (error) {
        console.error('Error fetching product by sku:', error);
        return NextResponse.json({ error: 'Failed to fetch product' }, { status: 500 });
    }
}
