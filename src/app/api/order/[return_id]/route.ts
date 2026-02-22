import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
    apiVersion: '2026-01-28.clover',
});

// GET /api/order/:return_id
export async function GET(
    request: Request,
    { params }: { params: Promise<{ return_id: string }> } // Awaiting params for Next 15+ 
) {
    try {
        const { return_id } = await params;

        if (!return_id) {
            return NextResponse.json({ error: 'Return ID (payment_intent) is required' }, { status: 400 });
        }
        // Retrieve from Stripe securely based on ID prefix
        let status, amount, currency, created, lineItemsData: any[] = [];

        if (return_id.startsWith('cs_')) {
            const session = await stripe.checkout.sessions.retrieve(return_id, {
                expand: ['line_items.data.price.product']
            });
            if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
            status = session.payment_status === 'paid' ? 'succeeded' : session.payment_status; // Map paid to succeeded
            amount = session.amount_total;
            currency = session.currency;
            created = session.created;
            lineItemsData = session.line_items?.data.map((item: any) => ({
                name: item.price?.product?.name || 'Product',
                image: item.price?.product?.images?.[0] || null,
                quantity: item.quantity,
                amount_total: item.amount_total
            })) || [];
        } else {
            const paymentIntent = await stripe.paymentIntents.retrieve(return_id);
            if (!paymentIntent) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
            status = paymentIntent.status;
            amount = paymentIntent.amount;
            currency = paymentIntent.currency;
            created = paymentIntent.created;
        }

        // Fire Facebook Meta CAPI `Purchase` server-side event
        if (status === 'succeeded') {
            const { sendMetaEvent } = require('@/utils/metaCapi');
            const userIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip') || null;
            const userAgent = request.headers.get('user-agent') || null;

            await sendMetaEvent({
                eventName: 'Purchase',
                eventSourceUrl: request.headers.get('referer') || request.url,
                userIp,
                userAgent,
                customData: {
                    currency: currency || process.env.STRIPE_CURRENCY || 'eur',
                    value: amount ? amount / 100 : 0,
                },
                eventId: return_id
            });

            // Fire UTMify API S2S (Server-to-Server) Event
            if (process.env.UTMIFY_TOKEN || process.env.UTMIFY_API_TOKEN) {
                try {
                    const token = process.env.UTMIFY_TOKEN || process.env.UTMIFY_API_TOKEN;

                    let customerEmail = 'nao_informado@email.com';
                    let customerName = 'Comprador';
                    let customerPhone = '11999999999';
                    let sessionMetadata = {};

                    if (return_id.startsWith('cs_')) {
                        const session: any = await stripe.checkout.sessions.retrieve(return_id);
                        customerEmail = session?.customer_details?.email || session?.customer_email || customerEmail;
                        customerName = session?.customer_details?.name || customerName;
                        customerPhone = session?.customer_details?.phone || customerPhone;
                        sessionMetadata = session?.metadata || {};
                    }

                    const utmifyPayload = {
                        order: {
                            orderId: return_id,
                            status: "approved",
                            createdAt: new Date().toISOString()
                        },
                        customer: {
                            name: customerName,
                            email: customerEmail,
                            phone: customerPhone.replace(/\D/g, '') || "11999999999",
                        },
                        products: lineItemsData.map((item: any, idx: number) => ({
                            id: item.id || `prod_stripe_${idx}`,
                            name: item.name || 'Produto',
                            planId: "1",
                            planName: "Unico"
                        })),
                        trackingParameters: sessionMetadata,
                        commission: amount ? amount / 100 : 0
                    };

                    await fetch('https://api.utmify.com.br/api-credentials/orders', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-token': token as string,
                        },
                        body: JSON.stringify(utmifyPayload)
                    });

                    console.log(`UTMify API Purchase Event sent for transaction: ${return_id}`);
                } catch (utmifyError) {
                    console.error('Error sending UTMify S2S event:', utmifyError);
                }
            }
        }

        return NextResponse.json({
            status,
            amount,
            currency,
            created,
            lineItems: lineItemsData
        });

    } catch (error: any) {
        console.error('Error validating order/payment_intent:', error);
        return NextResponse.json({ error: 'Failed to validate order' }, { status: 500 });
    }
}
