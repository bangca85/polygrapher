import React from 'react';
import { helperFunc } from '../lib/helper';

export const BookingForm = () => {
  const handleSubmit = () => {
    fetch('/api/booking', { method: 'POST' });
  };

  return <form onSubmit={handleSubmit}><button>Book</button></form>;
};
