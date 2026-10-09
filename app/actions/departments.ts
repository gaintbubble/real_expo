"use server";

import prisma from '../lib/prisma';

export async function editDepartment(id: string, name: string, triggerTime?: number | null) {
  try {
    const existing = await prisma.department.findUnique({
      where: { name }
    });

    if (existing && existing.id !== id) {
      return { success: false, message: "Another department with this name already exists" };
    }

    const department = await prisma.department.update({
      where: { id },
      data: { name, triggerTime }
    });

    return { success: true, department };
  } catch (error) {
    console.error("Edit department error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function getDepartments() {
  try {
    const departments = await prisma.department.findMany({
      orderBy: { name: 'asc' }
    });
    return departments;
  } catch (error) {
    console.error("Get departments error:", error);
    return [];
  }
}

export async function addDepartment(name: string, triggerTime?: number | null) {
  try {
    const existing = await prisma.department.findUnique({
      where: { name }
    });

    if (existing) {
      return { success: false, message: "Department already exists" };
    }

    const department = await prisma.department.create({
      data: { name, triggerTime }
    });

    return { success: true, department };
  } catch (error) {
    console.error("Add department error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function removeDepartment(id: string) {
  try {
    await prisma.department.delete({
      where: { id }
    });
    return { success: true };
  } catch (error) {
    console.error("Remove department error:", error);
    return { success: false, message: "Failed to remove, might be in use" };
  }
}
