"use server";

import prisma from '../lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getUsers() {
  try {
    const users = await prisma.user.findMany({
      where: {
        username: {
          not: 'admin'
        }
      },
      orderBy: { name: 'asc' }
    });
    return users;
  } catch (error) {
    console.error("Get users error:", error);
    return [];
  }
}

export async function addUser(username: string, name: string, mobileNo: string | null, departments: string[], modules: string[]) {
  try {
    const existing = await prisma.user.findUnique({
      where: { username }
    });

    if (existing) {
      return { success: false, message: "User with this username already exists" };
    }

    const user = await prisma.user.create({
      data: { username, name, mobileNo, departments, modules }
    });
    
    revalidatePath('/users');
    return { success: true, user };
  } catch (error) {
    console.error("Add user error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function editUser(id: string, username: string, name: string, mobileNo: string | null, departments: string[], modules: string[]) {
  try {
    const existing = await prisma.user.findUnique({
      where: { username }
    });

    if (existing && existing.id !== id) {
      return { success: false, message: "Another user with this username already exists" };
    }

    const userToEdit = await prisma.user.findUnique({ where: { id } });
    if (userToEdit?.username === 'admin') {
      // Ensure admin retains all modules and username
      if (username !== 'admin') {
        return { success: false, message: "Cannot change admin username" };
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: { username, name, mobileNo, departments, modules }
    });

    revalidatePath('/users');
    return { success: true, user };
  } catch (error) {
    console.error("Edit user error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function removeUser(id: string) {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (user?.username === 'admin') {
      return { success: false, message: "Cannot remove admin user" };
    }

    await prisma.user.delete({
      where: { id }
    });
    revalidatePath('/users');
    return { success: true };
  } catch (error) {
    console.error("Remove user error:", error);
    return { success: false, message: "Failed to remove user" };
  }
}

export async function resetPassword(id: string) {
  try {
    await prisma.user.update({
      where: { id },
      data: { password: "asram" }
    });
    return { success: true, message: "Password reset to default (asram)" };
  } catch (error) {
    console.error("Reset password error:", error);
    return { success: false, message: "Failed to reset password" };
  }
}
