import type { FC } from "@hono/hono/jsx";

interface ProfilePageProps {
  id: string;
  username: string;
  displayName: string;
  role: string;
  avatarKey?: string | null;
  error?: string;
}

const ProfilePage: FC<ProfilePageProps> = (props) => (
  <div>
    <h1>Profile</h1>
    {props.error && <p style="color:red">{props.error}</p>}
    <p>Username: {props.username}</p>
    <p>Display Name: {props.displayName}</p>
    <p>Role: {props.role}</p>
    <div style="margin:16px 0">
      {props.avatarKey
        ? <img src={`/avatars/${props.id}`} alt="Avatar" style="max-width:128px;border-radius:8px" />
        : <p>No avatar</p>}
    </div>
    <form method="post" action="/auth/avatar" enctype="multipart/form-data">
      <label>
        Upload Avatar
        <input type="file" name="avatar" accept="image/*" required />
      </label>
      <br />
      <button type="submit">Upload</button>
    </form>
    <p><a href="/dashboard">Back to Dashboard</a></p>
  </div>
);

const SignInPage: FC<{ error?: string }> = (props) => (
  <div>
    <h1>Sign In</h1>
    {props.error && <p style="color:red">{props.error}</p>}
    <form method="post" action="/auth/signin">
      <label>
        Username
        <input type="text" name="username" required />
      </label>
      <br />
      <label>
        Password
        <input type="password" name="password" required />
      </label>
      <br />
      <button type="submit">Sign In</button>
    </form>
    <p>
      <a href="/auth/register">Create an account</a>
    </p>
  </div>
);

const RegisterPage: FC<{ error?: string }> = (props) => (
  <div>
    <h1>Register</h1>
    {props.error && <p style="color:red">{props.error}</p>}
    <form method="post" action="/auth/register">
      <label>
        Username
        <input type="text" name="username" required />
      </label>
      <br />
      <label>
        Display Name
        <input type="text" name="display_name" required />
      </label>
      <br />
      <label>
        Password
        <input type="password" name="password" required />
      </label>
      <br />
      <button type="submit">Register</button>
    </form>
    <p>
      <a href="/auth/signin">Already have an account?</a>
    </p>
  </div>
);

export { ProfilePage, RegisterPage, SignInPage };
