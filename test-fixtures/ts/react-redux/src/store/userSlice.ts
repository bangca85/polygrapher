import { createSlice } from '@reduxjs/toolkit';

const userSlice = createSlice({
  name: 'users',
  initialState: { list: [], loading: false },
  reducers: {
    addUser: (state, action) => {
      state.list.push(action.payload);
    },
    removeUser: (state, action) => {
      state.list = state.list.filter(u => u.id !== action.payload);
    },
    setLoading: (state, action) => {
      state.loading = action.payload;
    },
  },
});

export const { addUser, removeUser, setLoading } = userSlice.actions;
export default userSlice.reducer;
