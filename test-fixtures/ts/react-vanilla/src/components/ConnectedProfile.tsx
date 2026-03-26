const mapStateToProps = (state: any) => ({ user: state.user });

function UserProfileInner() {
  return <div>User Profile</div>;
}

export default connect(mapStateToProps)(UserProfileInner);
