import React from 'react';
import { fetchUsers } from '../services/api';

const CreateEvent = () => {
  const handleSubmit = () => {
    fetchUsers();
  };
  return <div>Create Event Form</div>;
};

export default CreateEvent;
