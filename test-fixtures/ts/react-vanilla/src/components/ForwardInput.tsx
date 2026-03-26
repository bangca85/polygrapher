import React, { forwardRef } from 'react';

export const ForwardInput = forwardRef((props, ref) => {
  return <input ref={ref} {...props} />;
});
