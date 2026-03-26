import React, { memo } from 'react';

export const MemoList = memo(function List() {
  return <ul><li>Item 1</li></ul>;
});
