import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ bookings: [] });
}

export function POST(request: Request) {
  return NextResponse.json({ created: true });
}
